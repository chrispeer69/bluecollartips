import test from "node:test";
import assert from "node:assert/strict";
import { firstNameLastInitial, toPublicCompanyReview, toPublicReview, driverKey, scrubContact } from "../src/lib/public-reviews.ts";
import { readFile } from "node:fs/promises";

const publicRoute = await readFile(new URL("../src/routes/api/public/reviews.$companySlug.ts", import.meta.url), "utf8");

test("public feed validates slugs and requires the company sharing toggle", () => {
  assert.match(publicRoute, /COMPANY_SLUG\.test\(slug\)/);
  assert.match(publicRoute, /public_review_feed_enabled = true/);
  assert.match(publicRoute, /WHERE slug = \$\{slug\}/);
  assert.doesNotMatch(publicRoute, /PUBLIC_REVIEW_FEED_SLUGS/);
});

test("comments lose contact details before going public", () => {
  assert.equal(scrubContact("Call me at 614-555-0100 or pat@example.com"), "Call me at [phone removed] or [email removed]");
  assert.equal(scrubContact("Great job (614) 555 0100 thanks"), "Great job [phone removed] thanks");
  assert.equal(scrubContact("see www.example.com"), "see [link removed]");
  assert.equal(scrubContact("Tim was great, 5 stars!"), "Tim was great, 5 stars!");
});

test("names are first name + last initial only", () => {
  assert.equal(firstNameLastInitial("Mike Rodriguez"), "Mike R.");
  assert.equal(firstNameLastInitial("  mary ann   smith-jones "), "Mary S.");
  assert.equal(firstNameLastInitial("Chris"), "Chris");
  assert.equal(firstNameLastInitial(""), null);
  assert.equal(firstNameLastInitial(null), null);
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
  assert.equal(fresh.verified, false);
  assert.equal(toPublicReview({ ...base, public_ok: true, dispatch_match: "phone" }).verified, true);
  assert.equal(toPublicReview({ ...base, public_ok: true, dispatch_match: "name" }).verified, false, "name-only match is not verified");
  assert.equal(toPublicReview({ ...base, public_ok: true, review_context_id: "ctx" }).verified, true);
  const tagged = toPublicReview({ ...base, public_ok: true, job_city: "DUBLIN", job_service: "Flat Tire" });
  assert.equal(tagged.city, "Dublin");
  assert.equal(tagged.service, "Flat Tire");
  const gone = toPublicReview({ ...base, public_ok: true, driver_status: "deactivated" });
  assert.equal(gone.driver, null);
  assert.equal(gone.driverKey, null);
});

test("partner payload contains no employee, job, location, contact, or payment data", () => {
  const review = toPublicCompanyReview({
    id: "review-1", stars: 5, created_at: "2026-10-05T12:00:00Z",
    feedback: "Call 614-555-0100", customer_name: "Pat Jones", public_ok: true,
    driver_slug: "driver-name", driver_name: "Driver Name", driver_status: "active",
    review_context_id: "job-context", job_city: "Columbus", job_service: "Tow",
  });
  assert.deepEqual(Object.keys(review).sort(), ["createdAt", "customer", "stars", "text"]);
  assert.equal(review.customer, "Pat J.");
  assert.equal(review.text, "Call [phone removed]");
});
