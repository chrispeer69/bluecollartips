#!/usr/bin/env node
// Bulk-attribute company-level ratings to employees using a dispatch export.
//
//   node scripts/attribute-ratings.mjs dump  --company roadside-towing
//       Prints JSON: the company's unattributed ratings (with the dispatch job
//       id / customer details from the review link) and its employee roster.
//       Match these offline against the TowBook export, then:
//
//   node scripts/attribute-ratings.mjs apply --company roadside-towing \
//       --map "<ratingId>=<employeeSlug>,<ratingId>=<employeeSlug>,..."
//       Dry run by default; add --confirm to write.
//
// Production: railway ssh --service bluecollartips -- node scripts/attribute-ratings.mjs ...
import postgres from "postgres";

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
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) args[rest[i].slice(2)] = true;
    else { args[rest[i].slice(2)] = next; i++; }
  }
}
const need = (k) => { if (!args[k]) throw new Error(`--${k} is required`); return String(args[k]); };

async function company() {
  const slug = need("company");
  const [c] = await sql`SELECT id, name, slug FROM companies WHERE slug = ${slug}`;
  if (!c) throw new Error(`No company with slug "${slug}"`);
  return c;
}

async function dump() {
  const c = await company();
  const ratings = await sql`
    SELECT r.id, r.stars, r.created_at, r.customer_name, r.customer_phone, r.customer_email,
           LEFT(r.feedback, 60) AS feedback,
           rc.external_job_id, rc.dispatch_driver_name,
           rc.customer_name AS ctx_name, rc.customer_phone AS ctx_phone, rc.customer_email AS ctx_email
    FROM ratings r
    LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
    WHERE r.company_id = ${c.id} AND r.driver_id IS NULL
    ORDER BY r.created_at`;
  const employees = await sql`
    SELECT id, slug, display_name, status FROM drivers WHERE company_id = ${c.id} ORDER BY display_name`;
  console.log(JSON.stringify({ company: c, ratings, employees }));
}

async function apply() {
  const c = await company();
  const pairs = need("map").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [ratingId, slug] = p.split("=");
    if (!ratingId || !slug) throw new Error(`Bad map entry "${p}" (expected ratingId=employeeSlug)`);
    return { ratingId, slug };
  });
  const employees = await sql`SELECT id, slug, display_name FROM drivers WHERE company_id = ${c.id}`;
  const bySlug = new Map(employees.map((e) => [e.slug, e]));
  const ratings = await sql`
    SELECT id, driver_id, stars, customer_name FROM ratings
    WHERE company_id = ${c.id} AND id IN ${sql(pairs.map((p) => p.ratingId))}`;
  const byId = new Map(ratings.map((r) => [r.id, r]));

  const plan = [];
  for (const { ratingId, slug } of pairs) {
    const r = byId.get(ratingId);
    const e = bySlug.get(slug);
    if (!r) throw new Error(`Rating ${ratingId} not found in ${c.name}`);
    if (!e) throw new Error(`Employee slug "${slug}" not found in ${c.name}`);
    if (r.driver_id) throw new Error(`Rating ${ratingId} is already attributed`);
    plan.push({ ratingId, employee: e, rating: r });
  }
  for (const p of plan) console.log(`${p.rating.stars}★ ${p.rating.customer_name ?? "(no name)"}  ->  ${p.employee.display_name}`);
  if (!args.confirm) { console.log(`\nDry run: ${plan.length} ratings would be attributed. Add --confirm to write.`); return; }

  await sql.begin(async (tx) => {
    for (const p of plan) {
      await tx`UPDATE ratings SET driver_id = ${p.employee.id} WHERE id = ${p.ratingId} AND driver_id IS NULL`;
      await tx`UPDATE review_contexts SET driver_id = ${p.employee.id} WHERE rating_id = ${p.ratingId} AND driver_id IS NULL`;
    }
  });
  console.log(`\nAttributed ${plan.length} ratings.`);
}

try {
  if (command === "dump") await dump();
  else if (command === "apply") await apply();
  else { console.log("Usage: node scripts/attribute-ratings.mjs <dump|apply> --company <slug> [--map ...] [--confirm]"); process.exitCode = 1; }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
