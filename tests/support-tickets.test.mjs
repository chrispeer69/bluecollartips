import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Support ticket integration tests only run against a local database");
}

const db = postgres(databaseUrl, { max: 1 });
const rollback = Symbol("rollback");

test("support tickets: thread, status constraints, visibility scoping and cascade", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [company] = await tx`
        insert into companies (name, slug) values (${`Support Co ${suffix}`}, ${`support-co-${suffix}`}) returning id
      `;
      const [admin] = await tx`insert into users (email, full_name) values (${`admin-${suffix}@example.test`}, 'Ada Admin') returning id`;
      const [employee] = await tx`insert into users (email, full_name) values (${`emp-${suffix}@example.test`}, 'Eli Employee') returning id`;
      await tx`insert into user_roles (user_id, company_id, role) values (${admin.id}, ${company.id}, 'company_admin')`;
      await tx`insert into drivers (company_id, user_id, display_name, slug, status) values (${company.id}, ${employee.id}, 'Eli Employee', ${`eli-${suffix}`}, 'active')`;

      // Employee opens a ticket; admin opens another.
      const [t1] = await tx`
        insert into support_tickets (company_id, created_by, created_by_role, subject, category, priority, status)
        values (${company.id}, ${employee.id}, 'employee', 'Payout not received', 'payouts', 'high', 'waiting_on_platform') returning id
      `;
      const [t2] = await tx`
        insert into support_tickets (company_id, created_by, created_by_role, subject, category, status)
        values (${company.id}, ${admin.id}, 'company_admin', 'QR code will not scan', 'qr_links', 'waiting_on_platform') returning id
      `;
      await tx`insert into support_messages (ticket_id, author_id, author_kind, body) values (${t1.id}, ${employee.id}, 'tenant', 'I requested $40 a week ago.')`;
      await tx`insert into support_messages (ticket_id, author_id, author_kind, body) values (${t1.id}, ${admin.id}, 'platform', 'Checking now.')`;
      await tx`insert into support_messages (ticket_id, author_id, author_kind, internal, body) values (${t1.id}, ${admin.id}, 'platform', true, 'Stripe shows paid 9/10.')`;

      // Company admin sees both tickets; the employee sees only their own.
      const forAdmin = await tx`select id from support_tickets where company_id = ${company.id}`;
      assert.equal(forAdmin.length, 2);
      const forEmployee = await tx`select id from support_tickets where company_id = ${company.id} and created_by = ${employee.id}`;
      assert.deepEqual(forEmployee.map((r) => r.id), [t1.id]);

      // Internal notes are excluded from the tenant-visible thread.
      const visible = await tx`select body from support_messages where ticket_id = ${t1.id} and internal = false order by created_at`;
      assert.deepEqual(visible.map((r) => r.body), ["I requested $40 a week ago.", "Checking now."]);
      const all = await tx`select count(*)::int as n from support_messages where ticket_id = ${t1.id}`;
      assert.equal(all[0].n, 3);

      // Status and category are constrained.
      await assert.rejects(
        tx.savepoint((sp) => sp`update support_tickets set status = 'bogus' where id = ${t2.id}`),
        /support_tickets_status_check/,
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`insert into support_tickets (company_id, created_by, created_by_role, subject, category) values (${company.id}, ${admin.id}, 'company_admin', 'x', 'nope')`),
        /support_tickets_category_check/,
      );

      // Resolving records resolved_at; deleting the company removes everything.
      await tx`update support_tickets set status = 'resolved', resolved_at = now() where id = ${t1.id}`;
      const [resolved] = await tx`select resolved_at from support_tickets where id = ${t1.id}`;
      assert.ok(resolved.resolved_at);
      await tx`delete from companies where id = ${company.id}`;
      const [left] = await tx`select count(*)::int as n from support_messages where ticket_id in (${t1.id}, ${t2.id})`;
      assert.equal(left[0]?.n ?? left.n, 0);

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => { await db.end(); });
