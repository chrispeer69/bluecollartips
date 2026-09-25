import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const admin = await readFile(new URL("../src/routes/dashboard/admin.tsx", import.meta.url), "utf8");
const driver = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
const joinWorkspace = await readFile(new URL("../src/components/JoinWorkspacePanel.tsx", import.meta.url), "utf8");
const leaveWorkspace = await readFile(new URL("../src/components/LeaveWorkspacePanel.tsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const authFunctions = await readFile(new URL("../src/lib/auth.functions.ts", import.meta.url), "utf8");
const emailInvites = await readFile(new URL("../src/auth/email-invites.server.ts", import.meta.url), "utf8");
const inviteFunctions = await readFile(new URL("../src/lib/invites.functions.ts", import.meta.url), "utf8");
const driverFunctions = await readFile(new URL("../src/lib/driver.functions.ts", import.meta.url), "utf8");
const publicFunctions = await readFile(new URL("../src/lib/public.functions.ts", import.meta.url), "utf8");
const googleAuth = await readFile(new URL("../src/auth/google.server.ts", import.meta.url), "utf8");
const dashboardRouter = await readFile(new URL("../src/routes/dashboard/index.tsx", import.meta.url), "utf8");
const platformFunctions = await readFile(new URL("../src/lib/platform.functions.ts", import.meta.url), "utf8");
const companyCodesMigration = await readFile(new URL("../migrations/006_company_join_codes.sql", import.meta.url), "utf8");

test("admin dashboard exposes task-based sidebar pages", () => {
  for (const label of ["Overview", "Employees", "Ratings & feedback", "Tips & payments", "Company settings"]) {
    assert.match(admin, new RegExp(`label: "${label.replace(/[&]/g, "\\&")}"`));
  }
  for (const label of ["Platform overview", "Organizations", "Registered users", "Platform earnings"]) {
    assert.match(admin, new RegExp(`label: "${label.replace(/[&]/g, "\\&")}"`));
  }
  assert.match(admin, /const visibleNav = isPlatform \? platformNav : adminNav/);
  assert.match(admin, /workspace=\{/);
  assert.match(admin, /<DashboardShell/);
});

test("employee dashboard exposes workspace switcher and focused pages", () => {
  for (const label of ["Overview", "QR & share", "Tips & activity", "Earnings & withdrawals", "Payout account", "Settings"]) {
    assert.match(driver, new RegExp(`label: "${label.replace(/[&]/g, "\\&")}"`));
  }
  assert.match(driver, /employeeWorkspaceId/);
  assert.match(driver, /workspace=\{/);
  assert.match(driver, /useState<DriverPage>\("share"\)/, "QR & share is the employee default page");
  assert.match(driver, /Profile & identity/);
  assert.match(driver, /unique account identifier/);
  assert.match(driver, /does not change when you edit your display name/);
  assert.match(driver, /page === "payoutAccount" && <PayoutAccountPanel/);
  assert.match(driver, /Set up your payout account before requesting a withdrawal/);
});

test("customer tips use Stripe while external tips are employee-recorded", () => {
  assert.match(driver, /Customer payments from your Blue Collar Tips link or QR code are processed and recorded automatically through Stripe/);
  assert.match(driver, /Record a manual tip/);
  assert.doesNotMatch(driver, /Venmo handle|Cash App handle|Zelle email|PayPal handle/);
  assert.doesNotMatch(driverFunctions, /venmoHandle|cashappHandle|zelleHandle|paypalHandle/);
  assert.doesNotMatch(publicFunctions, /tipSource:/);
  assert.doesNotMatch(publicFunctions, /venmo_handle|cashapp_handle|zelle_handle|paypal_handle/);
});

test("dashboard shell supports desktop, mobile, and normal browser scrolling", () => {
  assert.match(shell, /lg:block/);
  assert.match(shell, /lg:hidden/);
  assert.doesNotMatch(shell, /lg:h-screen lg:overflow-hidden/);
  assert.doesNotMatch(shell, /<main className="flex-1 overflow-y-auto/);
  assert.match(shell, /sticky top-0/);
  assert.match(shell, /pageTitle/);
});

test("Google signup and invite redemption cover new and existing accounts", () => {
  assert.match(auth, /Create account with Google/);
  assert.match(auth, /params\.set\("intent", "company"\)/);
  assert.match(auth, /params\.set\("intent", "employee"\)/);
  assert.match(joinWorkspace, /claim\(\{ data: \{ inviteCode: code \} \}\)/);
  assert.doesNotMatch(admin, /<JoinWorkspacePanel/);
  assert.match(driver, /<JoinWorkspacePanel/);
  assert.match(dashboardRouter, /<JoinWorkspacePanel/);
  assert.match(admin, /Employee & admin invite codes/);
});

test("shared codes require approval while email invitations are restricted", () => {
  assert.match(admin, /Pending join requests/);
  assert.match(admin, /Approve/);
  assert.match(admin, /Reject/);
  assert.match(admin, /5-digit company code/);
  assert.match(admin, /Company employee code/);
  assert.match(admin, /Send email invite/);
  assert.match(joinWorkspace, /Request sent\. A company admin must approve you/);
  assert.match(companyCodesMigration, /companies_join_code_unique/);
  assert.match(companyCodesMigration, /join_requests_company_user_unique/);
  assert.match(emailInvites, /email IS NOT NULL/);
  assert.match(emailInvites, /LOWER\(email\)/);
  assert.match(emailInvites, /ON CONFLICT DO NOTHING/);
  assert.match(authFunctions, /acceptPendingEmailInvites\(user\.id, data\.email\)/);
  assert.match(googleAuth, /acceptPendingEmailInvites\(userId, googleEmail\)/);
  assert.match(driverFunctions, /acceptPendingEmailInvites\(userId, account\.email\)/);
});

test("employees can leave a workspace through an inline confirmation", () => {
  assert.match(driver, /<LeaveWorkspacePanel/);
  assert.match(leaveWorkspace, /Are you sure you want to leave/);
  assert.match(leaveWorkspace, /Yes, leave workspace/);
  assert.match(inviteFunctions, /export const leaveDriverWorkspace/);
  assert.match(inviteFunctions, /UPDATE drivers SET user_id = NULL/);
  assert.match(inviteFunctions, /DELETE FROM user_roles/);
  assert.doesNotMatch(leaveWorkspace, /window\.(?:alert|prompt|confirm)\s*\(/);
});

test("platform user administration exposes memberships and filters", () => {
  assert.match(platformFunctions, /user_roles/);
  assert.match(platformFunctions, /memberships: rolesByUser/);
  assert.match(admin, /Search name, email or organization/);
  assert.match(admin, /All organizations/);
  assert.match(admin, /All roles/);
  assert.match(admin, /Showing \{filteredUsers\.length\} of \{data\.users\.length\} users/);
  assert.match(platformFunctions, /id, driver_id, amount_cents/);
  assert.match(admin, /Platform fees earned/);
  assert.match(admin, /Organization fee breakdown/);
  assert.match(admin, /Recent customer payments/);
  assert.match(admin, /Latest payment/);
  assert.match(admin, /Customer details not provided/);
  // Owners get a per-employee earnings/payout view so "did my tech get paid?"
  // is answerable without opening each employee dashboard.
  assert.match(admin, /Employee earnings & payouts/);
  assert.match(admin, /Download CSV/);
  assert.match(admin, /Help & support/);
  assert.match(admin, /Support inbox/);
  assert.match(admin, /\{d\.email \|\| "No email added"\}/);
});

test("unique review links carry saved customer identity into payments", () => {
  assert.match(publicFunctions, /external_contact_id, customer_name, customer_phone, customer_email, dispatch_driver_name, expires_at/);
  assert.match(publicFunctions, /name: context\.customer_name \?\? null/);
});

test("dashboard actions use the shared UI instead of browser-native prompts and dropdowns", () => {
  for (const source of [admin, driver]) {
    assert.doesNotMatch(source, /window\.(?:alert|prompt|confirm)\s*\(/);
    assert.doesNotMatch(source, /<select(?:\s|>)/);
  }
  assert.match(admin, /Record completed payout/);
  assert.match(admin, /Confirm refund/);
  assert.match(admin, /Company share/);
  assert.match(driver, /Submit dispute/);
});
