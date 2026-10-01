import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dispatchPartnerEvents, partnerFeedPage, partnerKeyValid, partnerSlugs, retryDelayMs, signPartnerBody } from "../src/lib/partner-feed.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Partner feed integration tests only run against a local database");
}
const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");
async function inRollback(fn) {
  try { await db.begin(async (tx) => { await fn(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}

test("partner key, slugs and webhook signature", () => {
  const key = "k".repeat(32);
  assert.equal(partnerKeyValid(`Bearer ${key}`, key), true);
  assert.equal(partnerKeyValid(`Bearer ${key}x`, key), false);
  assert.equal(partnerKeyValid(null, key), false);
  assert.equal(partnerKeyValid("Bearer short", "short"), false, "feed stays off with a weak key");
  assert.deepEqual(partnerSlugs(" Roadside-Towing , other "), ["roadside-towing", "other"]);
  const body = '{"a":1}';
  assert.equal(signPartnerBody("s3cret", 1700000000, body), `sha256=${createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex")}`);
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(20), 6 * 3_600_000);
});

async function seed(tx) {
  const suffix = randomUUID().slice(0, 8);
  const [company] = await tx`insert into companies (name, slug) values (${`Feed Co ${suffix}`}, ${`feed-${suffix}`}) returning id, slug`;
  const [other] = await tx`insert into companies (name, slug) values (${`Other ${suffix}`}, ${`other-${suffix}`}) returning id, slug`;
  const [ana] = await tx`insert into drivers (company_id, display_name, slug, status, email, phone, employee_id)
    values (${company.id}, 'Ana Driver', ${`ana-${suffix}`}, 'active', ' Ana@Example.com ', '614-555-0101', 'E-7') returning id`;
  const [zed] = await tx`insert into drivers (company_id, display_name, slug, status) values (${other.id}, 'Zed', ${`zed-${suffix}`}, 'active') returning id`;
  const [ctx] = await tx`insert into review_contexts (company_id, driver_id, token_hash, external_job_id, expires_at, customer_name, job_city, job_service)
    values (${company.id}, ${ana.id}, ${randomUUID()}, 'TB-9001', now() + interval '1 day', 'Pat Lee Smith', 'Columbus', 'Tow') returning id`;
  return { company, other, ana, zed, ctx };
}

test("partner feed: triggers record changes; pull pages by since and cursor", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const old = new Date("2026-09-01T12:00:00Z");
    const [r1] = await tx`insert into ratings (company_id, driver_id, review_context_id, stars, feedback, created_at, updated_at)
      values (${s.company.id}, ${s.ana.id}, ${s.ctx.id}, 5, 'Great! Call me at 614-555-0199 or pat@x.com', ${old}, ${old}) returning id`;
    const [r2] = await tx`insert into ratings (company_id, driver_id, stars, customer_name, created_at, updated_at)
      values (${s.company.id}, ${s.ana.id}, 3, 'Sam', ${old}, ${old}) returning id`;
    const [r3] = await tx`insert into ratings (company_id, driver_id, stars, created_at, updated_at)
      values (${s.company.id}, ${s.ana.id}, 4, ${old}, ${old}) returning id`;
    await tx`insert into ratings (company_id, driver_id, stars) values (${s.other.id}, ${s.zed.id}, 1)`;

    let events = await tx`select event from partner_rating_events where company_id = ${s.company.id} order by id`;
    assert.deepEqual(events.map((e) => e.event), ["rating.created", "rating.created", "rating.created"]);

    // A change the partner cares about bumps updated_at and queues an update; others don't.
    await tx`update ratings set stars = 2 where id = ${r2.id}`;
    await tx`update ratings set flagged = true where id = ${r3.id}`;
    await tx`delete from ratings where id = ${r3.id}`;
    events = await tx`select event from partner_rating_events where company_id = ${s.company.id} order by id`;
    assert.deepEqual(events.map((e) => e.event), ["rating.created", "rating.created", "rating.created", "rating.updated", "rating.removed"]);
    const [bumped] = await tx`select updated_at > created_at as bumped from ratings where id = ${r2.id}`;
    assert.equal(bumped.bumped, true);

    const all = await partnerFeedPage(tx, { companyId: s.company.id, origin: "https://bct.test" });
    assert.equal(all.ratings.length, 3);
    const byId = Object.fromEntries(all.ratings.map((r) => [r.id, r]));
    assert.equal(byId[r1.id].comment, "Great! Call me at [phone removed] or [email removed]");
    assert.equal(byId[r1.id].towbookJobId, "TB-9001");
    assert.equal(byId[r1.id].jobCity, "Columbus");
    assert.equal(byId[r1.id].customerFirstNameLastInitial, "Pat S.");
    assert.equal(byId[r2.id].stars, 2);
    assert.equal(byId[r3.id].status, "removed");
    assert.equal(byId[r3.id].stars, 4, "removed rating keeps its last values");
    assert.equal(all.drivers.length, 1);
    assert.deepEqual(
      { email: all.drivers[0].email, employeeId: all.drivers[0].employeeId, count: all.drivers[0].ratingCount, avg: all.drivers[0].ratingAvg },
      { email: "ana@example.com", employeeId: "E-7", count: 2, avg: 3.5 },
    );

    // since: only what changed after the old timestamp (the update and the removal).
    const recent = await partnerFeedPage(tx, { companyId: s.company.id, origin: "https://bct.test", since: "2026-09-15T00:00:00Z" });
    assert.deepEqual(recent.ratings.map((r) => r.id).sort(), [r2.id, r3.id].sort());

    // Cursor paging returns every change exactly once.
    const p1 = await partnerFeedPage(tx, { companyId: s.company.id, origin: "https://bct.test", limit: 2 });
    assert.equal(p1.ratings.length, 2);
    assert.ok(p1.nextCursor);
    const p2 = await partnerFeedPage(tx, { companyId: s.company.id, origin: "https://bct.test", limit: 2, cursor: p1.nextCursor });
    assert.equal(p2.ratings.length, 1);
    assert.equal(p2.nextCursor, null);
    assert.deepEqual([...p1.ratings, ...p2.ratings].map((r) => r.id).sort(), all.ratings.map((r) => r.id).sort());
    await assert.rejects(partnerFeedPage(tx, { companyId: s.company.id, origin: "x", cursor: "garbage" }), /Invalid cursor/);
  });
});

test("partner webhook: signed POSTs, skips companies not shared, retries failures", async () => {
  await inRollback(async (tx) => {
    // Only events created in this test.
    await tx`update partner_rating_events set status = 'skipped' where status = 'pending'`;
    const s = await seed(tx);
    const [r1] = await tx`insert into ratings (company_id, driver_id, review_context_id, stars, feedback) values (${s.company.id}, ${s.ana.id}, ${s.ctx.id}, 5, 'Nice') returning id`;
    await tx`insert into ratings (company_id, driver_id, stars) values (${s.other.id}, ${s.zed.id}, 1)`;

    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response("ok", { status: 200 }); };
    const r = await dispatchPartnerEvents(tx, { url: "https://partner.test/hook", secret: "shh", slugs: [s.company.slug], origin: "https://bct.test", fetchImpl, now: () => 1_700_000_000_000 });
    assert.deepEqual(r, { sent: 1, failed: 0, skipped: 1, retry: 0 });
    const body = calls[0].init.body;
    const payload = JSON.parse(body);
    assert.equal(payload.event, "rating.created");
    assert.equal(payload.companySlug, s.company.slug);
    assert.equal(payload.rating.id, r1.id);
    assert.equal(payload.driver.email, "ana@example.com");
    assert.equal(calls[0].init.headers["x-bct-timestamp"], "1700000000");
    assert.equal(calls[0].init.headers["x-bct-signature"], signPartnerBody("shh", 1700000000, body));

    // Partner down: the event stays pending with a later retry time.
    await tx`update ratings set stars = 4 where id = ${r1.id}`;
    const failing = async () => new Response("nope", { status: 503 });
    const r2 = await dispatchPartnerEvents(tx, { url: "https://partner.test/hook", secret: "shh", slugs: [s.company.slug], origin: "x", fetchImpl: failing });
    assert.deepEqual(r2, { sent: 0, failed: 0, skipped: 0, retry: 1 });
    const [ev] = await tx`select status, attempts, last_error from partner_rating_events where rating_id = ${r1.id} and event = 'rating.updated'`;
    assert.deepEqual({ ...ev }, { status: "pending", attempts: 1, last_error: "HTTP 503" });

    // Deleted before sending: the partner is told it was removed.
    await tx`update partner_rating_events set next_attempt_at = now() - interval '1 minute' where rating_id = ${r1.id}`;
    await tx`delete from ratings where id = ${r1.id}`;
    calls.length = 0;
    await dispatchPartnerEvents(tx, { url: "https://partner.test/hook", secret: "shh", slugs: [s.company.slug], origin: "x", fetchImpl });
    const sent = calls.map((c) => JSON.parse(c.init.body));
    assert.ok(sent.length >= 2);
    assert.ok(sent.every((p) => p.event === "rating.removed" && p.rating.status === "removed"));
  });
});

test("partner feed wiring: private route, sender started with the server", async () => {
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
  const [route, server] = await Promise.all([read("src/routes/api/partner/driver-ratings.ts"), read("src/server.ts")]);
  assert.match(route, /partnerKeyValid\(request\.headers\.get\("authorization"\)\)/);
  assert.match(route, /partnerSlugs\(\)\.includes\(slug\)/);
  assert.match(server, /startPartnerDispatcher\(\)/);
});

test.after(async () => { await db.end(); });
