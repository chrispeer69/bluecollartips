import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { recordVipEvent, resolveVipJob, vipNextStep, vipReportRows } from "../src/lib/vip-report.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("VIP report integration tests only run against a local database");
}

const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");

async function inRollback(fn) {
  try {
    await db.begin(async (tx) => { await fn(tx); throw rollback; });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seed(tx) {
  const suffix = randomUUID().slice(0, 8);
  const [company] = await tx`insert into companies (name, slug) values (${`VIP Co ${suffix}`}, ${`vip-co-${suffix}`}) returning id`;
  const [other] = await tx`insert into companies (name, slug) values (${`Other ${suffix}`}, ${`other-${suffix}`}) returning id`;
  const [ana] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Ana', ${`ana-${suffix}`}, 'active') returning id`;
  const [zed] = await tx`insert into drivers (company_id, display_name, slug, status) values (${other.id}, 'Zed', ${`zed-${suffix}`}, 'active') returning id`;
  const at = (h) => new Date(Date.UTC(2026, 8, 24, h));
  const context = async (companyId, driverId, job, extra = {}) => {
    const [c] = await tx`
      insert into review_contexts (company_id, driver_id, token_hash, external_job_id, external_contact_id, expires_at,
        customer_name, customer_phone, customer_email, created_at)
      values (${companyId}, ${driverId}, ${randomUUID()}, ${job}, ${extra.contactId ?? null}, now() + interval '10 days',
        ${extra.name ?? null}, ${extra.phone ?? null}, ${extra.email ?? null}, ${extra.createdAt ?? at(12)})
      returning id`;
    return c.id;
  };
  const rating = async (companyId, driverId, contextId, stars, createdAt, extra = {}) => {
    const [r] = await tx`
      insert into ratings (company_id, driver_id, review_context_id, stars, feedback, customer_phone, created_at)
      values (${companyId}, ${driverId}, ${contextId}, ${stars}, ${extra.feedback ?? null}, ${extra.phone ?? null}, ${createdAt})
      returning id`;
    return r.id;
  };
  const tip = (companyId, driverId, ratingId, cents, createdAt, contact = null) => tx`
    insert into tips (company_id, driver_id, rating_id, amount_cents, source, customer_contact,
      driver_amount_cents, company_amount_cents, platform_amount_cents, created_at)
    values (${companyId}, ${driverId}, ${ratingId}, ${cents}, 'stripe', ${contact}, 0, 0, 0, ${createdAt})`;
  return { company, other, ana, zed, at, context, rating, tip };
}

test("vip report: responders only, tips linked or matched by phone, scoped to the company", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const c1 = await s.context(s.company.id, s.ana.id, "TB-1001", { name: "Pat Lee", phone: "(614) 555-0101", contactId: "ghl-1" });
    const c2 = await s.context(s.company.id, s.ana.id, "TB-1002", { name: "Sam Roe", phone: "614-555-0202" });
    const c3 = await s.context(s.company.id, s.ana.id, "TB-1003", { name: "No Reply" });
    const cz = await s.context(s.other.id, s.zed.id, "TB-1001", { name: "Other tenant" });
    const r1 = await s.rating(s.company.id, s.ana.id, c1, 5, s.at(13), { feedback: "Great tow" });
    const r2 = await s.rating(s.company.id, s.ana.id, c2, 4, s.at(14));
    // Walk-up QR review (no GHL job) and another tenant's review stay out.
    await s.rating(s.company.id, s.ana.id, null, 5, s.at(15));
    await s.rating(s.other.id, s.zed.id, cz, 5, s.at(13));
    void c3;

    await s.tip(s.company.id, s.ana.id, r1, 2000, s.at(13));
    // Older tip without a rating link, matched by the customer's phone digits.
    await s.tip(s.company.id, s.ana.id, null, 500, s.at(14), "+1 614 555 0202");
    // Same phone but days later: not this review's tip.
    await s.tip(s.company.id, s.ana.id, null, 900, new Date(Date.UTC(2026, 8, 28)), "6145550202");

    const rows = await vipReportRows(tx, {
      companyId: s.company.id,
      from: new Date(Date.UTC(2026, 8, 24)).toISOString(),
      to: new Date(Date.UTC(2026, 8, 24, 23, 59)).toISOString(),
    });
    assert.deepEqual(rows.map((r) => r.job_id).sort(), ["TB-1001", "TB-1002"]);
    const pat = rows.find((r) => r.job_id === "TB-1001");
    const sam = rows.find((r) => r.job_id === "TB-1002");
    assert.equal(pat.customer_name, "Pat Lee");
    assert.equal(pat.feedback, "Great tow");
    assert.equal(pat.tip_total_cents, 2000);
    assert.equal(sam.tip_total_cents, 500);
    assert.equal(sam.tip_count, 1);
    assert.equal(pat.convini_link_sent_count, 0);
    assert.equal(vipNextStep(pat).stage, "no_link");
    assert.ok(r2);
  });
});

test("vip events: resolve by contact id or phone, keep first timestamps, count repeats", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const c1 = await s.context(s.company.id, s.ana.id, "TB-2001", { phone: "614.555.0303", contactId: "ghl-9", email: "Pat@Example.com" });
    await s.rating(s.company.id, s.ana.id, c1, 5, s.at(13));

    assert.equal(await resolveVipJob(tx, s.company.id, { ghlContactId: "ghl-9" }), "TB-2001");
    assert.equal(await resolveVipJob(tx, s.company.id, { phone: "+1 (614) 555-0303" }), "TB-2001");
    assert.equal(await resolveVipJob(tx, s.company.id, { email: "pat@example.com" }), "TB-2001");
    assert.equal(await resolveVipJob(tx, s.other.id, { ghlContactId: "ghl-9" }), null);
    assert.equal(await resolveVipJob(tx, s.company.id, { phone: "555" }), null);

    const first = new Date(Date.UTC(2026, 8, 24, 15));
    const later = new Date(Date.UTC(2026, 8, 25, 15));
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "convini_link_sent", at: first });
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "convini_link_sent", at: later });
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "convini_clicked", at: later });
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "google_clicked", at: first });
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "google_clicked", at: later });

    let [row] = await vipReportRows(tx, { companyId: s.company.id });
    assert.equal(row.convini_link_sent_at, first.toISOString());
    assert.equal(row.convini_link_last_sent_at, later.toISOString());
    assert.equal(row.convini_link_sent_count, 2);
    assert.equal(row.convini_click_count, 1);
    assert.equal(row.google_clicked_at, first.toISOString());
    assert.equal(vipNextStep(row).stage, "clicked");
    assert.match(vipNextStep(row).action, /Google review/);

    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "convini_registered", at: later, source: "convini" });
    await recordVipEvent(tx, { companyId: s.company.id, jobId: "TB-2001", event: "google_review_posted", at: later, stars: 5 });
    [row] = await vipReportRows(tx, { companyId: s.company.id });
    assert.equal(row.convini_registered_source, "convini");
    assert.equal(row.google_stars, 5);
    assert.equal(vipNextStep(row).stage, "registered");
    assert.doesNotMatch(vipNextStep(row).action, /Google review/);
  });
});

test("vip wiring: public routes, admin checks and dashboard entry", async () => {
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
  const [events, go, fns, admin, thanks] = await Promise.all([
    read("src/routes/api/public/webhooks/ghl-events.ts"),
    read("src/routes/go.convini.ts"),
    read("src/lib/vip.functions.ts"),
    read("src/routes/dashboard/admin.tsx"),
    read("src/components/ReviewThankYou.tsx"),
  ]);
  assert.match(events, /verifyGhlSecret\(request\)/);
  assert.match(go, /PREVIEW_BOT/);
  assert.match(go, /FROM review_contexts WHERE company_id/);
  assert.equal((fns.match(/assertCompanyAdmin\(context\.userId/g) ?? []).length, 2);
  assert.match(admin, /page === "vip"/);
  assert.match(thanks, /onGoogleClick/);
});

test.after(async () => { await db.end(); });
