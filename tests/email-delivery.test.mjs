import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sender = await readFile(new URL("../src/lib/email/send.server.ts", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/lib/auth.functions.ts", import.meta.url), "utf8");
const invites = await readFile(new URL("../src/lib/email/invite.server.ts", import.meta.url), "utf8");

test("SMTP email/password credentials drive the shared transactional sender", () => {
  assert.match(sender, /process\.env\.email/);
  assert.match(sender, /process\.env\.email_password/);
  assert.match(sender, /nodemailer\.createTransport/);
  assert.match(sender, /transporter\.sendMail/);
});

test("invites and password resets use the shared email sender", () => {
  assert.match(invites, /sendEmail\(\{ to, subject, html, text \}\)/);
  assert.match(auth, /Reset your Blue Collar Tips password/);
  assert.match(auth, /await sendEmail/);
});
