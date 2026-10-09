import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { issueTipReviewLink, planTipReviewLink, recordTipLinkSent, tipLinkMessage } from "../src/lib/tip-link.server.ts";
import { e164, ghlSendSms, ghlUpsertContact } from "../src/lib/ghl-api.server.ts";
import { decryptSecret, encryptSecret } from "../src/lib/secret-box.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Tip link integration tests only run against a local database");
}
const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");
async function inRollback(fn) {
  try { await db.begin(async (tx) => { await fn(tx); throw rollback; }); } catch (error) { if (error !== rollback) throw error; }
}
const hash = (t) => createHash("sha256").update(t).digest("hex");
const tokenOf = (url) => new URL(url).searchParams.get("t");

async function seed(tx) {
  const suffix = randomUUID().slice(0, 8);
  const [company] = await tx`insert into companies (name, slug) values ('Roadside Co', ${`roadside-${suffix}`}) returning id, slug`;
  const [ana] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Ana Diaz', ${`ana-${suffix}`}, 'active') returning id, slug`;
  const context = async (job, extra = {}) => {
    const [c] = await tx`
      insert into review_contexts (company_id, driver_id, token_hash, external_job_id, external_contact_id, expires_at, customer_name, customer_phone)
      values (${company.id}, ${extra.driverId ?? null}, ${randomUUID()}, ${job}, ${extra.contactId ?? null}, ${extra.expiresAt ?? new Date(Date.now() - 86_400_000)},
        ${extra.name ?? null}, ${extra.phone ?? null})
      returning id`;
    return c.id;
  };
  return { company, ana, context };
}

test("tip link: expired unreviewed job by phone gets a fresh review link; old link dies", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const ctx = await s.context("TB-9001", { name: "Larry E", phone: "(614) 419-2238", driverId: s.ana.id, contactId: "ghl-larry" });
    const [before] = await tx`select token_hash from review_contexts where id = ${ctx}`;

    const plan = await planTipReviewLink(tx, s.company.id, { phone: "614.419.2238" });
    assert.equal(plan.contextId, ctx);
    assert.equal(plan.kind, "review");
    assert.equal(plan.jobId, "TB-9001");
    assert.equal(plan.driverName, "Ana Diaz");
    assert.equal(plan.ghlContactId, "ghl-larry");
    assert.match(tipLinkMessage(plan), /^Hi Larry, here's your new link from Roadside Co to rate your service with Ana Diaz and leave a tip: \{link\}$/);

    const { url, jobId } = await issueTipReviewLink(tx, s.company.id, plan, { origin: "https://bluecollartips.app/" });
    assert.equal(jobId, "TB-9001");
    assert.equal(url.split("?")[0], `https://bluecollartips.app/${s.company.slug}/d/${s.ana.slug}`);
    const [after] = await tx`select token_hash, expires_at > now() + interval '9 days' as fresh, consumed_at from review_contexts where id = ${ctx}`;
    assert.equal(after.token_hash, hash(tokenOf(url)));
    assert.notEqual(after.token_hash, before.token_hash);
    assert.equal(after.fresh, true);
    assert.equal(after.consumed_at, null);
  });
});

test("tip link: already-reviewed job goes straight to the tip for the review's driver", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const ctx = await s.context("TB-9002", { name: "Pat", phone: "6145550101" });
    const [r] = await tx`insert into ratings (company_id, driver_id, review_context_id, stars) values (${s.company.id}, ${s.ana.id}, ${ctx}, 5) returning id`;
    await tx`update review_contexts set consumed_at = now(), rating_id = ${r.id} where id = ${ctx}`;

    const plan = await planTipReviewLink(tx, s.company.id, { ratingId: r.id });
    assert.equal(plan.kind, "tip");
    assert.equal(plan.stars, 5);
    assert.match(tipLinkMessage(plan), /leave Ana Diaz a tip/);
    const { url } = await issueTipReviewLink(tx, s.company.id, plan, { origin: "https://x.test" });
    const q = new URL(url).searchParams;
    assert.equal(q.get("tip"), "1");
    assert.equal(q.get("r"), r.id);
    const [c] = await tx`select driver_id, consumed_at is not null as consumed from review_contexts where id = ${ctx}`;
    assert.equal(c.driver_id, s.ana.id, "context follows the review's driver so the tip page accepts it");
    assert.equal(c.consumed, true);

    // A company-level review with no driver can't be tipped.
    const ctx2 = await s.context("TB-9003", { phone: "6145550102" });
    const [r2] = await tx`insert into ratings (company_id, driver_id, review_context_id, stars) values (${s.company.id}, null, ${ctx2}, 4) returning id`;
    await tx`update review_contexts set consumed_at = now(), rating_id = ${r2.id} where id = ${ctx2}`;
    await assert.rejects(planTipReviewLink(tx, s.company.id, { ratingId: r2.id }), /assign it to a driver/i);
  });
});

test("tip link: unknown phone creates a new job; sends are counted; other companies are invisible", async () => {
  await inRollback(async (tx) => {
    const s = await seed(tx);
    const other = await seed(tx);
    await other.context("TB-OTHER", { phone: "6145550199" });

    const plan = await planTipReviewLink(tx, s.company.id, { phone: "614-555-0199", name: "New Person", driverId: s.ana.id });
    assert.equal(plan.contextId, null);
    const { url, jobId } = await issueTipReviewLink(tx, s.company.id, plan, { origin: "https://x.test" });
    assert.match(jobId, /^manual-/);
    const [c] = await tx`select customer_name, customer_phone, driver_id, token_hash from review_contexts where company_id = ${s.company.id} and external_job_id = ${jobId}`;
    assert.equal(c.customer_name, "New Person");
    assert.equal(c.driver_id, s.ana.id);
    assert.equal(c.token_hash, hash(tokenOf(url)));

    await recordTipLinkSent(tx, s.company.id, jobId, { userId: null, ghlContactId: "ghl-new" });
    await recordTipLinkSent(tx, s.company.id, jobId, { userId: null, ghlContactId: "ghl-ignored" });
    const [f] = await tx`select link_resent_count from vip_followups where company_id = ${s.company.id} and external_job_id = ${jobId}`;
    assert.equal(f.link_resent_count, 2);
    const [c2] = await tx`select external_contact_id from review_contexts where company_id = ${s.company.id} and external_job_id = ${jobId}`;
    assert.equal(c2.external_contact_id, "ghl-new");

    await assert.rejects(planTipReviewLink(tx, s.company.id, { phone: "555" }), /10-digit/);
  });
});

test("ghl api: upsert contact then SMS with the right headers and body", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const payload = url.endsWith("/contacts/upsert") ? { contact: { id: "c-1" } } : { messageId: "m-1" };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    const creds = { locationId: "loc-1", apiKey: "pit-secret-token-123456" };
    assert.equal(await ghlUpsertContact(creds, { name: "Larry E", phone: "(614) 419-2238" }), "c-1");
    assert.equal(await ghlSendSms(creds, "c-1", "Hi"), "m-1");
    assert.deepEqual(calls[0].body, { locationId: "loc-1", phone: "+16144192238", firstName: "Larry", lastName: "E" });
    assert.equal(calls[0].init.headers.Authorization, "Bearer pit-secret-token-123456");
    assert.equal(calls[0].init.headers.Version, "2021-07-28");
    assert.deepEqual(calls[1].body, { type: "SMS", contactId: "c-1", message: "Hi" });

    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(ghlSendSms(creds, "c-1", "Hi"), /rejected the API key/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(e164("+1 614 419 2238"), "+16144192238");
});

test("secret box round-trips and needs the key", () => {
  const saved = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = "k".repeat(40);
  try {
    const sealed = encryptSecret("pit-abc");
    assert.ok(!sealed.includes("pit-abc"));
    assert.equal(decryptSecret(sealed), "pit-abc");
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    assert.throws(() => encryptSecret("x"), /INTEGRATION_ENCRYPTION_KEY/);
  } finally {
    if (saved === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY; else process.env.INTEGRATION_ENCRYPTION_KEY = saved;
  }
});

test.after(() => db.end());
