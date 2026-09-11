import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/012_driver_wallet_payouts.sql", import.meta.url), "utf8");
const platformMigration = await readFile(new URL("../migrations/013_platform_payout_settings.sql", import.meta.url), "utf8");
const assignmentMigration = await readFile(new URL("../migrations/014_tip_driver_assignment_audit.sql", import.meta.url), "utf8");
const splitMigration = await readFile(new URL("../migrations/015_configurable_company_tip_share.sql", import.meta.url), "utf8");
const adminFunctions = await readFile(new URL("../src/lib/admin.functions.ts", import.meta.url), "utf8");
const wallet = await readFile(new URL("../src/lib/wallet.functions.ts", import.meta.url), "utf8");
const ledger = await readFile(new URL("../src/lib/stripe-tip-ledger.server.ts", import.meta.url), "utf8");
const stripeFunctions = await readFile(new URL("../src/lib/stripe.functions.ts", import.meta.url), "utf8");
const stripePanel = await readFile(new URL("../src/components/StripeCardPanel.tsx", import.meta.url), "utf8");
const driverDashboard = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const adminDashboard = await readFile(new URL("../src/routes/dashboard/admin.tsx", import.meta.url), "utf8");

test("wallet funds are immediate and the five days are only a processing window", () => {
  assert.match(migration, /Successful platform-collected Stripe tips are available immediately/);
  assert.match(migration, /payout_processing_days/);
  assert.match(platformMigration, /CREATE TABLE IF NOT EXISTS platform_settings/);
  assert.match(platformMigration, /singleton boolean PRIMARY KEY/);
  assert.doesNotMatch(migration, /available_at|hold_until|held_cents/);
  assert.match(wallet, /stripe_status = 'succeeded'/);
  assert.doesNotMatch(wallet, /NOW\(\) -|interval.*day|available_at/);
  assert.match(driverDashboard, /Successful online tips are available immediately/);
  assert.match(adminDashboard, /it is not a hold on earnings/);
});

test("only one open payout can reserve a driver's available balance", () => {
  assert.match(migration, /payout_requests_one_open_per_driver_idx/);
  assert.match(migration, /WHERE status IN \('pending', 'approved', 'processing'\)/);
  assert.match(wallet, /Only the employee can request this payout/);
  assert.match(wallet, /A payout request is already open/);
  assert.match(wallet, /Math\.max\(0, earnedCents - reservedCents\)/);
});

test("successful Stripe tips have webhook and browser-confirmed idempotent ledger paths", () => {
  assert.match(ledger, /ignoreDuplicates: true/);
  assert.match(ledger, /stripe_payment_intent_id/);
  assert.match(stripeFunctions, /paymentIntents\.retrieve/);
  assert.match(stripeFunctions, /pi\.client_secret !== data\.clientSecret/);
  assert.match(stripePanel, /finalizePayment/);
  assert.match(stripePanel, /paymentIntent\?\.status === "succeeded"/);
  assert.match(ledger, /webhook retries must never undo that/);
  assert.match(wallet, /export const syncStripeTipHistory/);
  assert.match(wallet, /scanned < 1000/);
});

test("company admins can assign verified company tips without cross-company access", () => {
  assert.match(assignmentMigration, /assigned_by/);
  assert.match(assignmentMigration, /assigned_at/);
  assert.match(adminFunctions, /export const assignCompanyTipToDriver/);
  assert.match(adminFunctions, /Employee does not belong to this company/);
  assert.match(adminFunctions, /Only verified, undisputed tips can be assigned/);
  assert.match(adminDashboard, /Unassigned company tips/);
  assert.match(adminDashboard, /Tip assigned successfully/);
});

test("company share is configurable from zero to ten while platform remains ten", () => {
  assert.match(splitMigration, /company_pct BETWEEN 0 AND 10/);
  assert.match(splitMigration, /platform_pct = 10/);
  assert.match(splitMigration, /90 - c_pct/);
  assert.match(adminFunctions, /export const updateCompanyTipShare/);
  assert.match(adminFunctions, /companyPercent: z\.number\(\)\.int\(\)\.min\(0\)\.max\(10\)/);
  assert.match(adminDashboard, /Company share \(0–10%\)/);
  assert.match(adminDashboard, /Employee receives/);
  assert.match(adminDashboard, /After platform fee/);
});

test("only platform admins configure and process manual wallet payouts", () => {
  assert.match(adminDashboard, /Minimum withdrawal \(\$\)/);
  assert.match(adminDashboard, /Payout processing window \(0–5 days\)/);
  assert.match(adminDashboard, /Mark paid/);
  assert.match(adminDashboard, /label: "Platform settings"/);
  assert.match(adminDashboard, /view === "platformPayments" && <PlatformWalletPanel mode="requests"/);
  assert.match(adminDashboard, /view === "platformSettings" && <PlatformWalletPanel mode="settings"/);
  assert.match(wallet, /requireSuperAdmin/);
  assert.match(wallet, /export const recoverStripeTip/);
  assert.match(wallet, /paymentIntents\.retrieve/);
  assert.match(adminDashboard, /Stripe tip recovery/);
  assert.match(adminDashboard, /recoverPayment/);
  assert.match(adminDashboard, /Recent Stripe tips/);
  assert.match(adminDashboard, /stripe_payment_intent_id/);
  assert.match(adminDashboard, /onTipsChanged/);
  assert.match(wallet, /action: z\.enum\(\["approve", "reject", "mark_paid"\]\)/);
  assert.doesNotMatch(wallet, /updateWalletSettings|getCompanyWallet|reviewWalletPayout/);
});
