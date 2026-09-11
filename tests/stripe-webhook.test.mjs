import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const webhook = await readFile(new URL("../src/routes/api/public/webhooks/stripe.ts", import.meta.url), "utf8");

test("Stripe webhook accepts separately configured live and sandbox signing secrets", () => {
  assert.match(webhook, /STRIPE_LIVE_WEBHOOK_SECRET/);
  assert.match(webhook, /STRIPE_TEST_WEBHOOK_SECRET/);
  assert.match(webhook, /for \(const secret of secrets\)/);
  assert.match(webhook, /Invalid Stripe signature/);
});
