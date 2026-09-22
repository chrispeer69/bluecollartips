// Runs the real query shim (src/db/client.server.ts) against a local database.
// Node strips the TypeScript types; see the "test:db" script.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, sql } from "../src/db/client.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const parsed = new URL(process.env.DATABASE_URL ?? "postgres://localhost");
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Query shim tests only run against a local database");
}

const suffix = randomUUID().slice(0, 8);
const made = { companyId: null, userId: null, inviteId: null };

test("select('*') is not mistaken for a column name", async () => {
  const { data, error } = await db.from("companies").select("*").limit(1);
  assert.equal(error, null, `select("*") failed: ${error?.message}`);
  assert.ok(Array.isArray(data));
});

test("embedded relations resolve without the caller selecting the foreign key", async (t) => {
  const database = sql();
  const [company] = await database`
    insert into companies (name, slug) values (${`Shim Co ${suffix}`}, ${`shim-co-${suffix}`}) returning id
  `;
  made.companyId = company.id;
  const [user] = await database`
    insert into users (email, full_name) values (${`shim-${suffix}@example.test`}, 'Sam Shim') returning id
  `;
  made.userId = user.id;
  const [invite] = await database`
    insert into invites (company_id, role, code) values (${company.id}, 'driver', ${`SHIM${suffix.toUpperCase()}`}) returning id, code
  `;
  made.inviteId = invite.id;
  await database`
    insert into join_requests (invite_id, company_id, user_id, status)
    values (${invite.id}, ${company.id}, ${user.id}, 'pending')
  `;

  t.after(async () => {
    await database`delete from join_requests where user_id = ${made.userId}`;
    await database`delete from invites where id = ${made.inviteId}`;
    await database`delete from users where id = ${made.userId}`;
    await database`delete from companies where id = ${made.companyId}`;
  });

  // The admin's pending-requests list asks only for embedded columns; the shim
  // has to pull user_id/invite_id itself or the admin sees a nameless row.
  const { data: requests, error } = await db
    .from("join_requests")
    .select("id, status, created_at, users(email, full_name), invites(code, role)")
    .eq("company_id", company.id);
  assert.equal(error, null, `join_requests select failed: ${error?.message}`);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].users?.full_name, "Sam Shim");
  assert.equal(requests[0].users?.email, `shim-${suffix}@example.test`);
  assert.equal(requests[0].invites?.code, `SHIM${suffix.toUpperCase()}`);

  // The invite landing page brands itself from the inviting company.
  const { data: peeked } = await db
    .from("invites")
    .select("role, email, expires_at, used_at, companies(name, slug)")
    .eq("id", invite.id)
    .maybeSingle();
  assert.equal(peeked?.companies?.name, `Shim Co ${suffix}`);
});

test.after(async () => { await sql().end(); });
