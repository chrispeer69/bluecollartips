import test from "node:test";
import assert from "node:assert/strict";
import { firstNameLastInitial, publicFeedAllowed, toPublicReview, driverKey } from "../src/lib/public-reviews.ts";

test("names are first name + last initial only", () => {
  assert.equal(firstNameLastInitial("Mike Rodriguez"), "Mike R.");
  assert.equal(firstNameLastInitial("  mary ann   smith-jones "), "Mary S.");
  assert.equal(firstNameLastInitial("Chris"), "Chris");
  assert.equal(firstNameLastInitial(""), null);
  assert.equal(firstNameLastInitial(null), null);
});

test("feed is opt-in per company", () => {
  assert.equal(publicFeedAllowed("roadside-towing", "roadside-towing, other"), true);
  assert.equal(publicFeedAllowed("someone-else", "roadside-towing"), false);
  assert.equal(publicFeedAllowed("roadside-towing", ""), false);
});

test("comments and names only with public_ok; stars always", () => {
  const base = { id: "1", stars: 2, created_at: "2026-09-01T12:00:00Z", feedback: "Late", customer_name: "Pat Jones", driver_slug: "mike", driver_name: "Mike Rodriguez", driver_status: "active" };
  const old = toPublicReview({ ...base, public_ok: false });
  assert.equal(old.stars, 2);
  assert.equal(old.text, null);
  assert.equal(old.customer, null);
  assert.equal(old.driver, "Mike R.");
  assert.equal(old.driverKey, driverKey("mike"));
  assert.ok(!/rodriguez/i.test(driverKey("mike-rodriguez")), "key never contains the last name");
  const fresh = toPublicReview({ ...base, public_ok: true });
  assert.equal(fresh.text, "Late");
  assert.equal(fresh.customer, "Pat J.");
  const gone = toPublicReview({ ...base, public_ok: true, driver_status: "deactivated" });
  assert.equal(gone.driver, null);
  assert.equal(gone.driverKey, null);
});
