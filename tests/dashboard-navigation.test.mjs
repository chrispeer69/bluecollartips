import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const admin = await readFile(new URL("../src/routes/dashboard/admin.tsx", import.meta.url), "utf8");
const driver = await readFile(new URL("../src/routes/dashboard/driver.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
const joinWorkspace = await readFile(new URL("../src/components/JoinWorkspacePanel.tsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const dashboardRouter = await readFile(new URL("../src/routes/dashboard/index.tsx", import.meta.url), "utf8");

test("admin dashboard exposes task-based sidebar pages", () => {
  for (const label of ["Overview", "Employees", "Ratings & feedback", "Tips & reconciliation", "Company settings", "Platform"]) {
    assert.match(admin, new RegExp(`label: "${label.replace(/[&]/g, "\\&")}"`));
  }
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
  assert.match(admin, /<JoinWorkspacePanel/);
  assert.match(driver, /<JoinWorkspacePanel/);
  assert.match(dashboardRouter, /<JoinWorkspacePanel/);
  assert.match(admin, /Employee & admin invite codes/);
});
