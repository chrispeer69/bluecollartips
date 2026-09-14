#!/usr/bin/env node
// Platform maintenance for tenants (companies). Runs against DATABASE_URL.
//
//   node scripts/tenant-admin.mjs list
//   node scripts/tenant-admin.mjs create --name "Alpha Automotive LLC" --slug alpha-automotive \
//        --admin-email dustin@example.com --admin-name "Dustin Keller" --phone "614-206-3606"
//   node scripts/tenant-admin.mjs delete --slug metro-hvac            (dry run: shows what would go)
//   node scripts/tenant-admin.mjs delete --slug metro-hvac --confirm  (actually deletes)
//
// In production run it inside the service container so the private DB host resolves:
//   railway ssh --service bluecollartips -- node scripts/tenant-admin.mjs list
import postgres from "postgres";
import { randomBytes } from "node:crypto";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL).hostname);
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: isLocal ? undefined : "require" });

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
}
const need = (k) => { if (!args[k]) throw new Error(`--${k} is required`); return String(args[k]); };
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function list() {
  const rows = await sql`
    SELECT c.name, c.slug, c.status, c.created_at::date AS created,
      (SELECT COUNT(*) FROM drivers d WHERE d.company_id = c.id)::int AS drivers,
      (SELECT COUNT(*) FROM ratings r WHERE r.company_id = c.id)::int AS ratings,
      (SELECT COUNT(*) FROM tips t WHERE t.company_id = c.id)::int AS tips,
      (SELECT COUNT(*) FROM user_roles u WHERE u.company_id = c.id AND u.role = 'company_admin')::int AS admins
    FROM companies c ORDER BY c.created_at`;
  console.table(rows.map((r) => ({ ...r, created: String(r.created).slice(0, 10) })));
}

async function create() {
  const name = need("name");
  const slug = args.slug ? slugify(String(args.slug)) : slugify(name);
  const adminEmail = need("admin-email").trim().toLowerCase();
  const adminName = args["admin-name"] ? String(args["admin-name"]) : null;
  const phone = args.phone ? String(args.phone) : null;
  const [exists] = await sql`SELECT id FROM companies WHERE slug = ${slug}`;
  if (exists) throw new Error(`A company with slug "${slug}" already exists`);

  const result = await sql.begin(async (tx) => {
    const [company] = await tx`
      INSERT INTO companies (name, slug, support_email, support_phone)
      VALUES (${name}, ${slug}, ${adminEmail}, ${phone})
      RETURNING id, name, slug`;
    // If the admin already has an account, attach the role directly; otherwise
    // leave an invite they redeem at /join/<code> when they sign up.
    const [user] = await tx`SELECT id FROM users WHERE email = ${adminEmail}`;
    let inviteCode = null;
    if (user) {
      await tx`INSERT INTO user_roles (user_id, company_id, role) VALUES (${user.id}, ${company.id}, 'company_admin') ON CONFLICT DO NOTHING`;
    } else {
      inviteCode = randomBytes(6).toString("hex").toUpperCase();
      const [anySuper] = await tx`SELECT user_id FROM user_roles WHERE role = 'super_admin' LIMIT 1`;
      await tx`
        INSERT INTO invites (company_id, code, role, email, created_by, expires_at)
        VALUES (${company.id}, ${inviteCode}, 'company_admin', ${adminEmail}, ${anySuper?.user_id ?? null},
                NOW() + INTERVAL '30 days')`;
    }
    return { company, attachedExistingUser: Boolean(user), inviteCode };
  });

  const base = (process.env.APP_BASE_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
  console.log(`Created ${result.company.name}`);
  console.log(`  Company page:  ${base}/${result.company.slug}`);
  console.log(`  Dashboard:     ${base}/dashboard/admin`);
  if (result.attachedExistingUser) {
    console.log(`  ${adminEmail} already had an account and is now a company admin.`);
  } else {
    console.log(`  Invite for ${adminName ?? adminEmail}: ${base}/join/${result.inviteCode}   (code ${result.inviteCode}, 30 days)`);
    console.log(`  Send that link to ${adminEmail}; they sign up with it and land in the workspace as admin.`);
  }
}

async function remove() {
  const slug = need("slug");
  const [company] = await sql`SELECT id, name, slug, status FROM companies WHERE slug = ${slug}`;
  if (!company) throw new Error(`No company with slug "${slug}"`);
  const [counts] = await sql`
    SELECT
      (SELECT COUNT(*) FROM drivers WHERE company_id = ${company.id})::int AS drivers,
      (SELECT COUNT(*) FROM ratings WHERE company_id = ${company.id})::int AS ratings,
      (SELECT COUNT(*) FROM tips WHERE company_id = ${company.id})::int AS tips,
      (SELECT COUNT(*) FROM user_roles WHERE company_id = ${company.id})::int AS roles,
      (SELECT COUNT(*) FROM invites WHERE company_id = ${company.id})::int AS invites,
      (SELECT COUNT(*) FROM support_tickets WHERE company_id = ${company.id})::int AS tickets`;
  console.log(`${company.name} (${company.slug}) — drivers ${counts.drivers}, ratings ${counts.ratings}, tips ${counts.tips}, roles ${counts.roles}, invites ${counts.invites}, tickets ${counts.tickets}`);
  if (counts.tips > 0 && !args.force) {
    throw new Error("This company has tips on record. Re-run with --confirm --force if you really want to delete financial history.");
  }
  if (!args.confirm) {
    console.log("Dry run. Add --confirm to delete this company and everything under it (cascades).");
    return;
  }
  await sql`DELETE FROM companies WHERE id = ${company.id}`;
  console.log(`Deleted ${company.name}.`);
}

// Change a company's URL slug (e.g. the app's random-suffix slug -> a clean one).
async function setSlug() {
  const slug = need("slug");
  const newSlug = slugify(need("new-slug"));
  const [company] = await sql`SELECT id, name FROM companies WHERE slug = ${slug}`;
  if (!company) throw new Error(`No company with slug "${slug}"`);
  const [taken] = await sql`SELECT id FROM companies WHERE slug = ${newSlug}`;
  if (taken) throw new Error(`Slug "${newSlug}" is already in use`);
  await sql`UPDATE companies SET slug = ${newSlug} WHERE id = ${company.id}`;
  const base = (process.env.APP_BASE_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
  console.log(`${company.name}: /${slug} -> /${newSlug}`);
  console.log(`  Company page: ${base}/${newSlug}   (old QR codes/links using /${slug} will stop working)`);
}

// Issue (or re-issue) a company-admin invite, or attach an existing user directly.
async function invite() {
  const slug = need("slug");
  const email = need("email").trim().toLowerCase();
  const [company] = await sql`SELECT id, name FROM companies WHERE slug = ${slug}`;
  if (!company) throw new Error(`No company with slug "${slug}"`);
  const base = (process.env.APP_BASE_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (user) {
    await sql`INSERT INTO user_roles (user_id, company_id, role) VALUES (${user.id}, ${company.id}, 'company_admin') ON CONFLICT DO NOTHING`;
    console.log(`${email} already has an account and is now a company admin of ${company.name}.`);
    console.log(`  Dashboard: ${base}/dashboard/admin`);
    return;
  }
  const existing = await sql`
    SELECT code, expires_at FROM invites
    WHERE company_id = ${company.id} AND role = 'company_admin' AND lower(email) = ${email}
      AND used_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1`;
  let code = existing[0]?.code;
  if (!code) {
    code = randomBytes(6).toString("hex").toUpperCase();
    const [anySuper] = await sql`SELECT user_id FROM user_roles WHERE role = 'super_admin' LIMIT 1`;
    await sql`
      INSERT INTO invites (company_id, code, role, email, created_by, expires_at)
      VALUES (${company.id}, ${code}, 'company_admin', ${email}, ${anySuper?.user_id ?? null}, NOW() + INTERVAL '30 days')`;
    console.log(`New admin invite for ${email} at ${company.name}:`);
  } else {
    console.log(`Existing unredeemed admin invite for ${email} at ${company.name}:`);
  }
  console.log(`  ${base}/join/${code}   (code ${code})`);
  console.log(`  Send that link; they sign up with it and land in the workspace as admin.`);
}

try {
  if (command === "list") await list();
  else if (command === "create") await create();
  else if (command === "delete") await remove();
  else if (command === "set-slug") await setSlug();
  else if (command === "invite") await invite();
  else {
    console.log("Usage: node scripts/tenant-admin.mjs <list|create|delete|set-slug|invite> [--options]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
