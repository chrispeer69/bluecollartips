import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { importResultsCsv, parseCompanyRows } from "../src/lib/company-import.ts";
import { importCompanies } from "../src/lib/company-import.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Company import integration tests only run against a local database");
}

test("parse: finds columns by name, flags bad rows, skips blanks", () => {
  const { rows } = parseCompanyRows([
    [null, null],
    ["Owner Email", "Business Name", "Phone", "Google Review Link"],
    ["A@Example.com ", "Alpha Towing", "614-555-0100", "https://g.page/r/a"],
    [null, null, null, null],
    ["not-an-email", "Bravo HVAC", null, null],
    ["c@example.com", "alpha towing", null, null],
    ["d@example.com", "Delta", null, "g.page/no-scheme"],
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    { ...rows[0], problems: rows[0].problems },
    {
      line: 3,
      name: "Alpha Towing",
      adminEmail: "a@example.com",
      phone: "614-555-0100",
      supportEmail: null,
      googleReviewUrl: "https://g.page/r/a",
      problems: [],
    },
  );
  assert.match(rows[1].problems.join(), /Owner email/);
  assert.match(rows[2].problems.join(), /earlier in the file/);
  assert.match(rows[3].problems.join(), /must start with http/);
  assert.throws(() => parseCompanyRows([["Name", "Phone"], ["X", "1"]]), /Owner email/);
});

test("parse: refuses more than 500 companies", () => {
  const rows = [["Company name", "Owner email"]];
  for (let i = 0; i < 501; i++) rows.push([`Co ${i}`, `o${i}@example.com`]);
  assert.throws(() => parseCompanyRows(rows), /up to 500/);
});

test("import: creates companies with invites, attaches existing owners, skips duplicates", async () => {
  const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
  const suffix = randomUUID().slice(0, 8);
  const created = [];
  try {
    const [admin] = await db`insert into users (email, full_name) values (${`super-${suffix}@example.com`}, 'Super') returning id`;
    const [owner] = await db`insert into users (email, full_name) values (${`owner-${suffix}@example.com`}, 'Owner') returning id`;
    const [existing] = await db`insert into companies (name, slug) values (${`Existing ${suffix}`}, ${`existing-${suffix}`}) returning id`;
    created.push(existing.id);

    const rows = [
      { name: `New Towing ${suffix}`, adminEmail: `NEW-${suffix}@example.com`, phone: "614-555-0100", supportEmail: null, googleReviewUrl: "https://g.page/r/x" },
      { name: `Owned HVAC ${suffix}`, adminEmail: `owner-${suffix}@example.com`, phone: null, supportEmail: null, googleReviewUrl: null },
      { name: `existing ${suffix}`, adminEmail: `x-${suffix}@example.com`, phone: null, supportEmail: null, googleReviewUrl: null },
    ];
    const results = await importCompanies(db, rows, admin.id, "https://bluecollartips.app/");
    assert.deepEqual(results.map((r) => r.status), ["created", "attached", "exists"]);

    const [co] = await db`select id, slug, support_phone, google_review_url from companies where name = ${rows[0].name}`;
    created.push(co.id);
    assert.equal(co.slug, `new-towing-${suffix}`);
    assert.equal(co.support_phone, "614-555-0100");
    const [invite] = await db`select code, role, email from invites where company_id = ${co.id}`;
    assert.equal(invite.role, "company_admin");
    assert.equal(invite.email, `new-${suffix}@example.com`);
    assert.equal(results[0].inviteUrl, `https://bluecollartips.app/join/${invite.code}`);

    const [owned] = await db`select id from companies where name = ${rows[1].name}`;
    created.push(owned.id);
    const [role] = await db`select role from user_roles where user_id = ${owner.id} and company_id = ${owned.id}`;
    assert.equal(role.role, "company_admin");
    assert.equal(results[1].inviteUrl, null);

    // Same name again gets a distinct slug only if the name differs; identical names are skipped.
    const again = await importCompanies(db, [rows[0]], admin.id, "https://bluecollartips.app");
    assert.equal(again[0].status, "exists");

    const csv = importResultsCsv(results, "https://bluecollartips.app");
    assert.match(csv, /Created — send invite link/);
    assert.match(csv, new RegExp(`https://bluecollartips.app/new-towing-${suffix}`));
  } finally {
    if (created.length) await db`delete from companies where id in ${db(created)}`;
    await db`delete from users where email like ${`%-${suffix}@example.com`}`;
    await db.end();
  }
});
