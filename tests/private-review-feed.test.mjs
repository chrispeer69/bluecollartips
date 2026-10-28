import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { firstNameOnly, toPrivateCompanyReview, toPublicCompanyReview, driverKey } from "../src/lib/public-reviews.ts";
import { jobDetailColumns } from "../src/lib/review-webhooks.server.ts";
import { db as appDb } from "../src/db/client.server.ts";
import { privateFeedAuth, privateFeedTokenHashes, privateFeedBody, sha256Hex, createFailureLimiter, clientIp } from "../src/lib/private-review-feed.server.ts";

const privateRoute = await readFile(new URL("../src/routes/api/private/reviews.$companySlug.ts", import.meta.url), "utf8");
const publicRoute = await readFile(new URL("../src/routes/api/public/reviews.$companySlug.ts", import.meta.url), "utf8");

const ghlWebhook = await readFile(new URL("../src/routes/api/public/webhooks/ghl.ts", import.meta.url), "utf8");

const TOKEN = "t".repeat(20) + "0123456789abcdef0123";
const ENV = `roadside-towing:${sha256Hex(TOKEN)}`;

test("first name only: never a last name or last initial", () => {
  assert.equal(firstNameOnly("Tim Wilson"), "Tim");
  assert.equal(firstNameOnly("Tim W."), "Tim");
  assert.equal(firstNameOnly("  mary ann   smith-jones "), "Mary");
  assert.equal(firstNameOnly("TIM"), "Tim");
  assert.equal(firstNameOnly("tim"), "Tim");
  assert.equal(firstNameOnly("McKenzie Smith"), "McKenzie");
  assert.equal(firstNameOnly("O'Neil"), "O'Neil");
  assert.equal(firstNameOnly("Jean-Luc Picard"), "Jean-Luc");
  assert.equal(firstNameOnly(""), null);
  assert.equal(firstNameOnly("   "), null);
  assert.equal(firstNameOnly(null), null);
  assert.equal(firstNameOnly("123"), null);
});

test("token config: only sha256 hashes, bad entries ignored", () => {
  const map = privateFeedTokenHashes(` Roadside-Towing:${sha256Hex(TOKEN).toUpperCase()} , bad entry, other:abc, x:${"g".repeat(64)}`);
  assert.deepEqual([...map.keys()], ["roadside-towing"]);
  assert.equal(map.get("roadside-towing").toString("hex"), sha256Hex(TOKEN));
  assert.equal(privateFeedTokenHashes("").size, 0);
});

test("auth: 404 (off) when not configured, 401 without or with a wrong token, ok with the right one", () => {
  assert.equal(privateFeedAuth("roadside-towing", `Bearer ${TOKEN}`, ""), "off", "no env -> feature off");
  assert.equal(privateFeedAuth("other-company", `Bearer ${TOKEN}`, ENV), "off", "token for another company only");
  assert.equal(privateFeedAuth("roadside-towing", null, ENV), "unauthorized");
  assert.equal(privateFeedAuth("roadside-towing", "", ENV), "unauthorized");
  assert.equal(privateFeedAuth("roadside-towing", "Bearer", ENV), "unauthorized");
  assert.equal(privateFeedAuth("roadside-towing", `Bearer ${TOKEN}x`, ENV), "unauthorized");
  assert.equal(privateFeedAuth("roadside-towing", `Basic ${TOKEN}`, ENV), "unauthorized");
  assert.equal(privateFeedAuth("roadside-towing", sha256Hex(TOKEN), ENV), "unauthorized", "the stored hash is not a token");
  assert.equal(privateFeedAuth("roadside-towing", `Bearer ${sha256Hex(TOKEN)}`, ENV), "unauthorized", "the stored hash is not a token");
  assert.equal(privateFeedAuth("roadside-towing", `Bearer ${TOKEN}`, ENV), "ok");
  assert.equal(privateFeedAuth("roadside-towing", `bearer   ${TOKEN}`, ENV), "ok");
  const weak = "short";
  assert.equal(privateFeedAuth("roadside-towing", `Bearer ${weak}`, `roadside-towing:${sha256Hex(weak)}`), "unauthorized", "weak tokens never work");
});

test("route: no CORS, 404 when off, 401 without detail, cache keyed by slug, company must be active", () => {
  assert.doesNotMatch(privateRoute, /Access-Control/);
  assert.doesNotMatch(privateRoute, /OPTIONS/);
  assert.match(privateRoute, /if \(auth === "off"\) return json\(404/);
  assert.match(privateRoute, /if \(auth !== "ok"\) \{[\s\S]*?limiter\.fail\(ip\);\s*return json\(401, \{ error: "Unauthorized" \}\)/);
  assert.ok(privateRoute.indexOf("privateFeedAuth(slug") < privateRoute.indexOf("limiter.blocked(ip)"), "a valid token is never rate limited");
  assert.match(privateRoute, /status = 'active'/);
  assert.match(privateRoute, /cache\.get\(slug\)/);
  assert.match(privateRoute, /cache\.set\(slug,/);
  assert.match(privateRoute, /no-store/);
  assert.doesNotMatch(privateRoute, /console\./, "never logs the request or token");
});

test("failed-auth limiter blocks an IP after repeated failures and resets after the window", () => {
  const l = createFailureLimiter(3, 1000);
  for (let i = 0; i < 3; i++) { assert.equal(l.blocked("1.2.3.4", 0), false); l.fail("1.2.3.4", 0); }
  assert.equal(l.blocked("1.2.3.4", 10), true);
  assert.equal(l.blocked("5.6.7.8", 10), false);
  assert.equal(l.blocked("1.2.3.4", 2000), false);
  assert.equal(clientIp(new Request("https://x.test", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");
});

test("public feed is unchanged: still slim, still opt-in", () => {
  assert.match(publicRoute, /toPublicCompanyReview/);
  assert.match(publicRoute, /public_review_feed_enabled = true/);
  assert.doesNotMatch(publicRoute, /drivers|job_city|review_contexts|driver_name/);
  const row = { id: "1", stars: 5, created_at: "2026-10-05T12:00:00Z", feedback: "Great", customer_name: "Pat Jones", public_ok: true,
    driver_slug: "tim-wilson", driver_name: "Tim Wilson", driver_status: "active", review_context_id: "ctx", job_city: "Columbus", job_service: "Tow" };
  assert.deepEqual(Object.keys(toPublicCompanyReview(row)).sort(), ["createdAt", "customer", "stars", "text"]);
});

test("private review shape: driver first name only, city/service/verified, public_ok rules kept", () => {
  const base = { id: "r1", stars: 5, created_at: "2026-10-05T12:00:00Z", feedback: "Tim was great, call 614-555-0100", customer_name: "Pat Jones",
    driver_slug: "tim-wilson", driver_name: "Tim Wilson", driver_status: "active", review_context_id: "ctx", job_city: "GROVE CITY", job_service: "Jump Start" };
  const r = toPrivateCompanyReview({ ...base, public_ok: true });
  assert.deepEqual(Object.keys(r).sort(), ["city", "createdAt", "customer", "driver", "driverKey", "id", "service", "stars", "text", "verified"]);
  assert.equal(r.driver, "Tim");
  assert.equal(r.driverKey, driverKey("tim-wilson"));
  assert.equal(r.city, "Grove City");
  assert.equal(r.service, "Jump Start");
  assert.equal(r.verified, true);
  assert.equal(r.customer, "Pat J.");
  assert.equal(r.text, "Tim was great, call [phone removed]");
  const old = toPrivateCompanyReview({ ...base, public_ok: false });
  assert.equal(old.text, null);
  assert.equal(old.customer, null);
  assert.equal(old.driver, "Tim", "employee first name shows on every rating, like the old feed");
  const gone = toPrivateCompanyReview({ ...base, public_ok: true, driver_status: "deactivated" });
  assert.equal(gone.driver, null);
  assert.equal(gone.driverKey, null);
  const none = toPrivateCompanyReview({ ...base, public_ok: true, driver_slug: null, driver_name: null, driver_status: null, job_city: null });
  assert.equal(none.driver, null);
  assert.equal(none.city, null);
});

test("GHL review-link webhook keeps accepting the job's city and service (optional fields)", () => {
  assert.match(ghlWebhook, /^\s*city: optionalText\(z\.string\(\)\.trim\(\)\.max\(120\)\)/m);
  assert.match(ghlWebhook, /^\s*service: optionalText\(z\.string\(\)\.trim\(\)\.max\(120\)\)/m);
  assert.match(ghlWebhook, /\.\.\.jobDetailColumns\(parsed\.data\.city, parsed\.data\.service\)/);
  assert.doesNotMatch(ghlWebhook, /job_city: parsed\.data\.city \?\? null/, "a re-send without city must not write null");
  assert.deepEqual(jobDetailColumns("Dublin", "Tow"), { job_city: "Dublin", job_service: "Tow" });
  assert.deepEqual(jobDetailColumns(undefined, undefined), {});
  assert.deepEqual(jobDetailColumns("  ", null), {});
  assert.deepEqual(jobDetailColumns(" Grove City ", ""), { job_city: "Grove City" });
});

// ---- Integration against a LOCAL database (same guard as the partner feed tests). ----
try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Private review feed integration tests only run against a local database");
}
const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");
async function inRollback(fn) {
  try { await db.begin(async (tx) => { await fn(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
test.after(() => db.end());

test("private feed body: first names, city from the rating or its review link, no contact data", async () => {
  await inRollback(async (tx) => {
    const suffix = randomUUID().slice(0, 8);
    const [company] = await tx`insert into companies (name, slug) values (${`Feed Co ${suffix}`}, ${`feed-${suffix}`}) returning id, name, slug`;
    const [tim] = await tx`insert into drivers (company_id, display_name, slug, status, email, phone, photo_url)
      values (${company.id}, 'Tim Wilson', ${`tim-wilson-${suffix}`}, 'active', 'tim@example.com', '614-555-0101', '/photos/tim.jpg') returning id, slug`;
    const [old] = await tx`insert into drivers (company_id, display_name, slug, status)
      values (${company.id}, 'Gone Person', ${`gone-${suffix}`}, 'deactivated') returning id`;
    const [ctx] = await tx`insert into review_contexts (company_id, driver_id, token_hash, external_job_id, expires_at, customer_name, customer_phone, job_city, job_service)
      values (${company.id}, ${tim.id}, ${randomUUID()}, 'TB-1', now() + interval '1 day', 'Pat Lee Smith', '614-555-0199', 'Dublin', 'Tow') returning id`;
    const [fromLink] = await tx`insert into ratings (company_id, driver_id, review_context_id, stars, feedback, customer_name, customer_phone, public_ok, created_at)
      values (${company.id}, ${tim.id}, ${ctx.id}, 5, 'Fast!', 'Pat Lee Smith', '614-555-0199', true, now() - interval '2 days') returning id`;
    const [tagged] = await tx`insert into ratings (company_id, driver_id, stars, public_ok, job_city, job_service, dispatch_match, created_at)
      values (${company.id}, ${tim.id}, 4, true, 'COLUMBUS', 'Lockout', 'phone', now() - interval '1 day') returning id`;
    const [gone] = await tx`insert into ratings (company_id, driver_id, stars, public_ok, created_at)
      values (${company.id}, ${old.id}, 3, true, now()) returning id`;

    const body = await privateFeedBody(tx, company, "https://bct.test");
    assert.deepEqual(Object.keys(body).sort(), ["company", "drivers", "generatedAt", "publicTextSince", "reviews"]);
    assert.deepEqual(body.company, { name: company.name, slug: company.slug });
    assert.deepEqual(body.drivers, [{ key: driverKey(tim.slug), name: "Tim", photoUrl: "https://bct.test/photos/tim.jpg" }]);
    const byId = Object.fromEntries(body.reviews.map((r) => [r.id, r]));
    assert.equal(body.reviews.length, 3);
    assert.deepEqual(
      { driver: byId[fromLink.id].driver, city: byId[fromLink.id].city, service: byId[fromLink.id].service, verified: byId[fromLink.id].verified, customer: byId[fromLink.id].customer },
      { driver: "Tim", city: "Dublin", service: "Tow", verified: true, customer: "Pat S." },
    );
    assert.deepEqual(
      { driver: byId[tagged.id].driver, city: byId[tagged.id].city, service: byId[tagged.id].service, verified: byId[tagged.id].verified },
      { driver: "Tim", city: "Columbus", service: "Lockout", verified: true },
    );
    assert.equal(byId[gone.id].driver, null);
    assert.equal(byId[gone.id].driverKey, null);
    const raw = JSON.stringify(body);
    for (const leak of ["Wilson", "tim@example.com", "614-555", "TB-1", "Lee Smith", tim.id, ctx.id, "Gone"]) {
      assert.ok(!raw.includes(leak), `payload must not contain ${leak}`);
    }
  });
});

test("GHL re-send for the same job: missing city/service keeps the stored values; a new city replaces it", async () => {
  // Same upsert call the webhook makes (app db wrapper, onConflict company_id,external_job_id).
  const suffix = randomUUID().slice(0, 8);
  const [company] = await db`insert into companies (name, slug) values (${`Resend Co ${suffix}`}, ${`resend-${suffix}`}) returning id`;
  try {
    const send = (city, service) => appDb.from("review_contexts").upsert({
      company_id: company.id, driver_id: null, token_hash: randomUUID(), external_job_id: "TB-77",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), customer_name: "Pat",
      ...jobDetailColumns(city, service),
    }, { onConflict: "company_id,external_job_id" });
    const row = async () => (await db`select job_city, job_service from review_contexts where company_id = ${company.id} and external_job_id = 'TB-77'`)[0];

    assert.equal((await send("Dublin", "Tow")).error, null);
    assert.deepEqual({ ...(await row()) }, { job_city: "Dublin", job_service: "Tow" });

    assert.equal((await send(undefined, undefined)).error, null);
    assert.deepEqual({ ...(await row()) }, { job_city: "Dublin", job_service: "Tow" }, "missing city/service keeps the old values");

    assert.equal((await send("", "  ")).error, null);
    assert.deepEqual({ ...(await row()) }, { job_city: "Dublin", job_service: "Tow" }, "blank city/service keeps the old values");

    assert.equal((await send("Hilliard", undefined)).error, null);
    assert.deepEqual({ ...(await row()) }, { job_city: "Hilliard", job_service: "Tow" }, "a new city replaces the old one");

    assert.equal((await send(undefined, "Jump Start")).error, null);
    assert.deepEqual({ ...(await row()) }, { job_city: "Hilliard", job_service: "Jump Start" }, "a new service replaces the old one");
  } finally {
    await db`delete from review_contexts where company_id = ${company.id}`;
    await db`delete from companies where id = ${company.id}`;
    const { sql: appSql } = await import("../src/db/client.server.ts");
    await appSql().end();
  }
});
