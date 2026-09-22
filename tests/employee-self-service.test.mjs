import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Employee self-service integration tests only run against a local database");
}

const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");

const driver = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
const myReviews = await readFile(new URL("../src/components/MyReviewsPanel.tsx", import.meta.url), "utf8");
const payoutHistory = await readFile(new URL("../src/components/PayoutHistoryPanel.tsx", import.meta.url), "utf8");
const wallet = await readFile(new URL("../src/lib/wallet.functions.ts", import.meta.url), "utf8");

test("employees get their own reviews, tips and payouts in the dashboard", () => {
  assert.match(driver, /label: "My reviews"/);
  assert.match(driver, /<MyReviewsPanel/);
  assert.match(driver, /title="Withdrawal history"/);
  assert.match(driver, /<PayoutHistoryPanel/);
  // Employees print only themselves.
  assert.match(myReviews, /lockedDriverId=\{driverId\}/);
  // Payout account numbers stay encrypted server-side and never reach the page.
  assert.doesNotMatch(payoutHistory, /payout_details_encrypted/);
  assert.doesNotMatch(wallet.slice(wallet.indexOf("getDriverPayoutHistory")), /^[\s\S]{0,1600}?payout_details_encrypted/);
});

test("dashboard shell gives phones a bottom tab bar inside the safe area", () => {
  assert.match(shell, /mobileTabs/);
  assert.match(shell, /env\(safe-area-inset-bottom\)/);
  assert.match(shell, /aria-label="Sections"/);
  // The tab bar is phone-only and the page pads for it so nothing hides behind.
  assert.match(shell, /fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card lg:hidden/);
  assert.match(shell, /pb-28[^"]*lg:pb-6/);
  assert.match(driver, /mobileTabs=\{\["share", "reviews", "tips", "earnings"\]\}/);
});

test("payout history shows an employee every withdrawal without leaking account details", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [company] = await tx`
        insert into companies (name, slug) values (${`Payout Co ${suffix}`}, ${`payout-co-${suffix}`}) returning id
      `;
      const [user] = await tx`insert into users (email, full_name) values (${`emp-${suffix}@example.test`}, 'Eve Employee') returning id`;
      const [d] = await tx`
        insert into drivers (company_id, user_id, display_name, slug, status, payout_method, payout_account_name)
        values (${company.id}, ${user.id}, 'Eve Employee', ${`eve-${suffix}`}, 'active', 'cash_app', '$EveTows')
        returning id
      `;
      const [other] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Otto Other', ${`otto-${suffix}`}, 'active') returning id`;

      await tx`
        insert into payout_requests (company_id, driver_id, amount_cents, status, requested_by, requested_at, paid_at, payment_reference)
        values
          (${company.id}, ${d.id}, 4000, 'paid', ${user.id}, now() - interval '20 days', now() - interval '18 days', 'CA-123'),
          (${company.id}, ${d.id}, 2500, 'rejected', ${user.id}, now() - interval '10 days', null, null),
          (${company.id}, ${d.id}, 3000, 'pending', ${user.id}, now() - interval '1 day', null, null),
          (${company.id}, ${other.id}, 9900, 'paid', ${user.id}, now(), now(), 'NOPE')
      `;

      // Mirrors getDriverPayoutHistory in src/lib/wallet.functions.ts.
      const rows = await tx`
        SELECT pr.id, pr.amount_cents, pr.status, pr.requested_at, pr.reviewed_at, pr.paid_at,
               pr.payment_method, pr.payment_reference, pr.admin_note,
               COALESCE(pr.requested_payout_method, d.payout_method) AS payout_method,
               COALESCE(pr.requested_payout_account_name, d.payout_account_name) AS payout_account_name
        FROM payout_requests pr
        JOIN drivers d ON d.id = pr.driver_id
        WHERE pr.driver_id = ${d.id}
        ORDER BY pr.requested_at DESC
        LIMIT 200
      `;

      // Newest first, this employee only — every status, not just the open one.
      assert.deepEqual(rows.map((r) => r.status), ["pending", "rejected", "paid"]);
      assert.ok(rows.every((r) => r.payment_reference !== "NOPE"));
      // The destination falls back to the driver's saved method; no ciphertext.
      assert.deepEqual([...new Set(rows.map((r) => r.payout_method))], ["cash_app"]);
      assert.deepEqual([...new Set(rows.map((r) => r.payout_account_name))], ["$EveTows"]);
      assert.ok(rows.every((r) => !("payout_details_encrypted" in r)));

      const paid = rows.filter((r) => r.status === "paid").reduce((n, r) => n + r.amount_cents, 0);
      const open = rows.filter((r) => ["pending", "approved", "processing"].includes(r.status)).reduce((n, r) => n + r.amount_cents, 0);
      assert.equal(paid, 4000);
      assert.equal(open, 3000);

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => { await db.end(); });
