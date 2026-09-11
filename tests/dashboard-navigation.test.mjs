import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const admin = await readFile(new URL("../src/routes/dashboard/admin.tsx", import.meta.url), "utf8");
const driver = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
const joinWorkspace = await readFile(new URL("../src/components/JoinWorkspacePanel.tsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const dashboardRouter = await readFile(new URL("../src/routes/dashboard/index.tsx", import.meta.url), "utf8");
const platformFunctions = await readFile(new URL("../src/lib/platform.functions.ts", import.meta.url), "utf8");
const companyCodesMigration = await readFile(new URL("../migrations/006_company_join_codes.sql", import.meta.url), "utf8");

test("admin dashboard exposes task-based sidebar pages", () => {
  for (const label of ["Overview", "Employees", "Ratings & feedback", "Tips & reconciliation", "Company settings"]) {
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
  for (const label of ["Overview", "QR & share", "Tips & activity", "Earnings & payouts", "Settings"]) {
    assert.match(driver, new RegExp(`label: "${label.replace(/[&]/g, "\\&")}"`));
  }
  assert.match(driver, /employeeWorkspaceId/);
  assert.match(driver, /workspace=\{/);
  assert.match(driver, /useState<DriverPage>\("share"\)/, "QR & share is the employee default page");
  assert.match(driver, /Profile & identity/);
  assert.match(driver, /unique account identifier/);
  assert.match(driver, /does not change when you edit your display name/);
});

test("dashboard shell supports desktop, mobile, and independently scrolling content", () => {
  assert.match(shell, /lg:block/);
  assert.match(shell, /lg:hidden/);
  assert.match(shell, /overflow-y-auto/);
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
  assert.match(admin, /\{d\.email \|\| "—"\}/);
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
