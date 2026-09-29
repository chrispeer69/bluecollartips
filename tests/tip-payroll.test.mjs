import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { addDaysYmd, lastCompletedWeekStart, payWeekStart, tipPayrollReport } from "../src/lib/tip-payroll.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Tip payroll integration tests only run against a local database");
}
const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");

test("pay weeks run Saturday through Friday", () => {
  // Sep 19, 2026 is a Saturday.
  assert.equal(payWeekStart("2026-09-19"), "2026-09-19");
  assert.equal(payWeekStart("2026-09-22"), "2026-09-19");
  assert.equal(payWeekStart("2026-09-25"), "2026-09-19"); // Friday
  assert.equal(payWeekStart("2026-09-26"), "2026-09-26"); // next Saturday
  assert.equal(addDaysYmd("2026-09-19", 6), "2026-09-25");
  // Last finished week: on Saturday Sep 26 it's Sep 19–25; on Friday Oct 2 it's still Sep 19–25.
  assert.equal(lastCompletedWeekStart("2026-09-26"), "2026-09-19");
  assert.equal(lastCompletedWeekStart("2026-09-29"), "2026-09-19");
  assert.equal(lastCompletedWeekStart("2026-10-02"), "2026-09-19");
  assert.equal(lastCompletedWeekStart("2026-10-03"), "2026-09-26");
});

test("tip payroll: employee share of card tips, Eastern week edges, cash for records only", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [company] = await tx`insert into companies (name, slug, company_pct) values (${`Payroll Co ${suffix}`}, ${`payroll-${suffix}`}, 10) returning id`;
      const [other] = await tx`insert into companies (name, slug) values (${`Other ${suffix}`}, ${`other-${suffix}`}) returning id`;
      const [ana] = await tx`insert into drivers (company_id, display_name, slug, status, employee_id) values (${company.id}, 'Ana Driver', ${`ana-${suffix}`}, 'active', 'E-1') returning id`;
      const [ben] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Ben Driver', ${`ben-${suffix}`}, 'active') returning id`;
      const [idle] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Cal Idle', ${`cal-${suffix}`}, 'active') returning id`;
      const [gone] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Dee Gone', ${`dee-${suffix}`}, 'deactivated') returning id`;
      const [zed] = await tx`insert into drivers (company_id, display_name, slug, status) values (${other.id}, 'Zed', ${`zed-${suffix}`}, 'active') returning id`;
      const [user] = await tx`insert into users (email, full_name) values (${`payroll-${suffix}@example.com`}, 'Ana User') returning id`;
      void idle; void gone;

      const tip = (companyId, driverId, cents, at, source = "stripe", extra = {}) => tx`
        insert into tips (company_id, driver_id, amount_cents, source, customer_name, created_at, refunded_at, disputed,
                          driver_amount_cents, company_amount_cents, platform_amount_cents)
        values (${companyId}, ${driverId}, ${cents}, ${source}, ${extra.customer ?? null}, ${at}, ${extra.refunded ?? null}, ${extra.disputed ?? false}, 0, 0, 0)`;

      // Week of Sat Sep 19 – Fri Sep 25, 2026 (Eastern = UTC-4).
      await tip(company.id, ana.id, 2000, "2026-09-19T04:30:00Z", "stripe", { customer: "Sat 12:30am ET" }); // in
      await tip(company.id, ana.id, 1000, "2026-09-26T03:30:00Z", "stripe", { customer: "Fri 11:30pm ET" }); // in
      await tip(company.id, ana.id, 5000, "2026-09-26T04:30:00Z"); // Sat 12:30am ET next week: out
      await tip(company.id, ana.id, 3000, "2026-09-19T03:30:00Z"); // Fri 11:30pm ET previous week: out
      await tip(company.id, ana.id, 1500, "2026-09-21T15:00:00Z", "cash"); // records only
      await tip(company.id, ben.id, 4000, "2026-09-22T15:00:00Z");
      await tip(company.id, ben.id, 2500, "2026-09-23T15:00:00Z", "stripe", { refunded: "2026-09-24T12:00:00Z" }); // held
      await tip(company.id, null, 1000, "2026-09-23T16:00:00Z"); // unassigned card tip
      await tip(other.id, zed.id, 9900, "2026-09-22T15:00:00Z"); // another company

      await tx`
        insert into payout_requests (company_id, driver_id, amount_cents, status, requested_by, paid_at)
        values (${company.id}, ${ana.id}, 1200, 'paid', ${user.id}, '2026-09-24T14:00:00Z')`;

      const r = await tipPayrollReport(tx, company.id, "2026-09-23");
      assert.deepEqual(r.week, { start: "2026-09-19", end: "2026-09-25" });
      const by = Object.fromEntries(r.employees.map((e) => [e.name, e]));

      // Employee keeps 80% of card tips (90 - 10% company).
      assert.equal(by["Ana Driver"].cardCount, 2);
      assert.equal(by["Ana Driver"].cardGrossCents, 3000);
      assert.equal(by["Ana Driver"].payrollCents, 2400);
      assert.equal(by["Ana Driver"].employeeId, "E-1");
      assert.equal(by["Ana Driver"].otherCents, 1500, "cash is listed but not added");
      assert.equal(by["Ana Driver"].appPayoutCents, 1200);

      assert.equal(by["Ben Driver"].payrollCents, 3200);
      assert.equal(by["Ben Driver"].heldTips.length, 1, "refunded tip held back");

      assert.equal(by["Cal Idle"].payrollCents, 0, "active employee with no tips still listed");
      assert.equal(by["Dee Gone"], undefined, "inactive employee with no tips left off");
      assert.equal(by["Zed"], undefined, "other company excluded");

      assert.deepEqual(r.unassignedCardTips, { count: 1, grossCents: 1000 });
      assert.equal(r.totals.payrollCents, 5600);
      assert.equal(r.totals.cardGrossCents, 8000); // 2000 + 1000 + 4000 + 1000 unassigned
      assert.equal(r.totals.heldCount, 1);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => { await db.end(); });
