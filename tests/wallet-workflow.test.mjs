import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../migrations/012_driver_wallet_payouts.sql", import.meta.url), "utf8");
const platformMigration = await readFile(new URL("../migrations/013_platform_payout_settings.sql", import.meta.url), "utf8");
const assignmentMigration = await readFile(new URL("../migrations/014_tip_driver_assignment_audit.sql", import.meta.url), "utf8");
const splitMigration = await readFile(new URL("../migrations/015_configurable_company_tip_share.sql", import.meta.url), "utf8");
const companyWalletMigration = await readFile(new URL("../migrations/016_company_wallet_payouts.sql", import.meta.url), "utf8");
const destinationMigration = await readFile(new URL("../migrations/017_payout_destinations.sql", import.meta.url), "utf8");
const manualTipsMigration = await readFile(new URL("../migrations/018_manual_tips_bookkeeping_only.sql", import.meta.url), "utf8");
const destinationCrypto = await readFile(new URL("../src/lib/payout-destination.server.ts", import.meta.url), "utf8");
const adminFunctions = await readFile(new URL("../src/lib/admin.functions.ts", import.meta.url), "utf8");
const wallet = await readFile(new URL("../src/lib/wallet.functions.ts", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../src/lib/reconciliation.functions.ts", import.meta.url), "utf8");
const ledger = await readFile(new URL("../src/lib/stripe-tip-ledger.server.ts", import.meta.url), "utf8");
const stripeFunctions = await readFile(new URL("../src/lib/stripe.functions.ts", import.meta.url), "utf8");
const stripePanel = await readFile(new URL("../src/components/StripeCardPanel.tsx", import.meta.url), "utf8");
const driverDashboard = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const adminDashboard = await readFile(new URL("../src/routes/dashboard/admin.tsx", import.meta.url), "utf8");
const payoutDestinationForm = await readFile(new URL("../src/components/PayoutDestinationForm.tsx", import.meta.url), "utf8");

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
  assert.match(wallet, /amountCents: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(wallet, /Withdrawal amount exceeds the available balance/);
  assert.match(driverDashboard, /Withdrawal amount/);
  assert.match(driverDashboard, /amountCents: withdrawalCents/);
});

test("company wallets reserve only finalized Stripe earnings", () => {
  assert.match(companyWalletMigration, /CREATE TABLE IF NOT EXISTS company_payout_requests/);
  assert.match(companyWalletMigration, /company_payout_requests_one_open_per_company_idx/);
  assert.match(wallet, /export const getCompanyWallet/);
  assert.match(wallet, /export const requestCompanyWalletPayout/);
  assert.match(wallet, /driver_id IS NOT NULL OR assigned_at IS NOT NULL/);
  assert.match(wallet, /A company payout request is already open/);
  assert.match(adminDashboard, /Section title="Company wallet"/);
  assert.match(adminDashboard, /Available to withdraw/);
  assert.match(adminDashboard, /Choose any amount from/);
});

test("successful Stripe tips have webhook and browser-confirmed idempotent ledger paths", () => {
  assert.match(ledger, /ignoreDuplicates: true/);
  assert.match(ledger, /stripe_payment_intent_id/);
  assert.match(stripeFunctions, /paymentIntents\.retrieve/);
  assert.match(stripeFunctions, /pi\.client_secret !== data\.clientSecret/);
  assert.match(stripePanel, /finalizePayment/);
  assert.match(stripePanel, /paymentIntent\?\.status === "succeeded"/);
  assert.match(stripePanel, /paymentIntent\?\.status === "processing"/);
  assert.match(stripePanel, /paymentMethodName\(paymentMethod\)/);
  assert.match(stripeFunctions, /automatic_payment_methods: \{ enabled: true \}/);
  assert.match(ledger, /webhook retries must never undo that/);
  assert.match(wallet, /export const syncStripeTipHistory/);
  assert.match(wallet, /scanned < 1000/);
});

test("manual tips are fee-free bookkeeping and cannot fund withdrawals", () => {
  assert.match(manualTipsMigration, /IF NEW\.source <> 'stripe'/);
  assert.match(manualTipsMigration, /NEW\.driver_amount_cents := NEW\.amount_cents/);
  assert.match(manualTipsMigration, /NEW\.platform_amount_cents := 0/);
  assert.match(manualTipsMigration, /WHERE source <> 'stripe'/);
  assert.match(wallet, /AND source = 'stripe'/);
  assert.match(driverDashboard, /No company or platform fee was applied/);
  assert.match(driverDashboard, /Bookkeeping only · not withdrawable/);
});

test("company admins can assign verified company tips without cross-company access", () => {
  assert.match(assignmentMigration, /assigned_by/);
  assert.match(assignmentMigration, /assigned_at/);
  assert.match(adminFunctions, /export const assignCompanyTipToDriver/);
  assert.match(adminFunctions, /Employee does not belong to this company/);
  assert.match(adminFunctions, /Only verified, undisputed tips can be assigned/);
  assert.match(adminFunctions, /assignedTo: driver \? "employee" : "company"/);
  assert.match(adminDashboard, /Unassigned company tips/);
  assert.match(adminDashboard, /Tip finalized for the company/);
  assert.match(adminDashboard, /<SelectItem value="company">Company<\/SelectItem>/);
});

test("employee keeps 90% of card tips; the company share is locked at zero", async () => {
  const keep90 = await readFile(new URL("../migrations/030_employee_keeps_90.sql", import.meta.url), "utf8");
  assert.match(splitMigration, /platform_pct = 10/);
  assert.match(splitMigration, /90 - c_pct/);
  assert.match(keep90, /CHECK \(company_pct = 0\)/);
  assert.match(keep90, /company_payout_requests/, "past tips of companies with company payouts are left alone");
  assert.doesNotMatch(adminFunctions, /updateCompanyTipShare/);
  assert.doesNotMatch(adminDashboard, /Tip distribution/);
  assert.match(adminDashboard, /90% employee · 10% Blue Collar Tips/);
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
  assert.match(adminDashboard, /View payment reporting by company/);
  assert.match(adminDashboard, /All companies/);
  assert.match(adminDashboard, /Open payouts/);
  assert.match(wallet, /action: z\.enum\(\["approve", "reject", "mark_paid"\]\)/);
  assert.doesNotMatch(wallet, /updateWalletSettings|reviewWalletPayout/);
});

test("employee payout accounting remains available while owners see paid-customer details", () => {
  assert.match(reconciliation, /FROM drivers d/);
  assert.match(reconciliation, /LEFT JOIN tip_totals/);
  assert.match(reconciliation, /pending_payout_cents/);
  assert.match(reconciliation, /paid_out_cents/);
  assert.match(reconciliation, /stripe_status = 'succeeded'/);
  assert.match(adminDashboard, /Recent customer payments/);
  assert.match(adminDashboard, /customer_contact/);
  assert.match(adminDashboard, /tip\.stripe_status === "succeeded"/);
  assert.doesNotMatch(adminDashboard, /Employee tips & payouts/);
});

test("manual payout destinations are encrypted and snapshotted onto requests", () => {
  assert.match(destinationMigration, /payout_details_encrypted/);
  assert.match(destinationMigration, /requested_payout_details_encrypted/);
  assert.match(destinationCrypto, /aes-256-gcm/);
  assert.match(destinationCrypto, /PAYOUT_DETAILS_ENCRYPTION_KEY/);
  assert.match(wallet, /saveDriverPayoutDestination/);
  assert.match(wallet, /saveCompanyPayoutDestination/);
  assert.match(wallet, /Add your payout details before requesting a payout/);
  assert.match(adminDashboard, /navigator\.clipboard\.writeText\(d\.id\)/);
  assert.match(driverDashboard, /Tip wallet & withdrawals/);
  assert.match(driverDashboard, /id: "payoutAccount", label: "Payout account"/);
  assert.match(driverDashboard, /My payout account/);
  assert.match(payoutDestinationForm, /Bank account holder name/);
  assert.match(payoutDestinationForm, /U\.S\. bank account \(ACH\)/);
  assert.match(payoutDestinationForm, /Routing number/);
  assert.match(payoutDestinationForm, /Account number/);
  assert.match(payoutDestinationForm, /ending in/);
  assert.match(payoutDestinationForm, /setEditing\(!initial\)/);
  assert.match(adminDashboard, /formatPayoutDetails/);
  assert.match(wallet, /routingNumber: z\.string\(\)\.regex\(\/\^\\d\{9\}\$\//);
  assert.match(wallet, /checksum % 10 !== 0/);
});
