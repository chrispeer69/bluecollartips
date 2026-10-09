import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { REVIEW_SITE_IDS } from "@/lib/review-sites";

async function assertCompanyAdmin(userId: string, companyId: string) {
  const { db } = await import("@/db/client.server");
  const { data: roles } = await db.from("user_roles").select("role, company_id").eq("user_id", userId);
  const ok = roles?.some((r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === companyId));
  if (!ok) throw new Error("Forbidden");
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * VIP customer follow-up report: customers who answered a GHL review request,
 * with their review, tip, Google review and Convini app status.
 */
export const getVipReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      driverId: z.string().uuid().optional(),
      // The calendar days shown for assignment (company local dates).
      fromDay: day.optional(),
      toDay: day.optional(),
      // "Follow-ups due" mode: everyone whose next call is on or before this date.
      dueOn: day.optional(),
      // Today in the viewer's zone, for the due-count banner.
      today: day.optional(),
      // Customer name / phone / email, searched across every date.
      search: z.string().trim().max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const { vipReportRows, listVipStaff, vipDayAssignments, vipDueCount, vipCallHistory } = await import("@/lib/vip-report.server");
    const [company] = await sql()`
      SELECT id, name, slug, logo_url, primary_color, secondary_color FROM companies WHERE id = ${data.companyId}`;
    if (!company) throw new Error("Not found");
    const rows = await vipReportRows(sql(), { companyId: data.companyId, from: data.from, to: data.to, driverId: data.driverId, dueOn: data.dueOn, search: data.search, limit: 1000 });
    return {
      company: {
        id: company.id as string,
        name: company.name as string,
        slug: company.slug as string,
        logo_url: (company.logo_url ?? null) as string | null,
        primary_color: (company.primary_color ?? null) as string | null,
        secondary_color: (company.secondary_color ?? null) as string | null,
      },
      range: { from: data.from ?? null, to: data.to ?? null },
      rows,
      truncated: rows.length >= 1000,
      staff: await listVipStaff(sql(), data.companyId),
      drivers: (await sql()`
        SELECT id, display_name FROM drivers WHERE company_id = ${data.companyId} AND status = 'active' ORDER BY lower(display_name)`)
        .map((d: any) => ({ id: d.id as string, name: d.display_name as string })),
      calls: await vipCallHistory(sql(), data.companyId, [...new Set(rows.map((r) => r.job_id))]),
      dueCount: data.today ? await vipDueCount(sql(), data.companyId, data.today) : 0,
      dayAssignments: data.fromDay && data.toDay ? await vipDayAssignments(sql(), data.companyId, data.fromDay, data.toDay) : {},
    };
  });

const when = z.string().datetime({ offset: true }).nullable().optional();

/** Staff updates from the VIP page: Google review, Convini status, contact notes. */
export const updateVipFollowup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      jobId: z.string().trim().min(1).max(200),
      googlePostedAt: when,
      googleStars: z.number().int().min(1).max(5).nullable().optional(),
      conviniLinkSentAt: when,
      conviniRegisteredAt: when,
      contactedAt: when,
      notes: z.string().max(2000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const [known] = await sql()`
      SELECT 1 FROM review_contexts WHERE company_id = ${data.companyId} AND external_job_id = ${data.jobId}`;
    if (!known) throw new Error("Job not found");

    // Only fields the caller sent are changed; `null` clears a field.
    const has = (k: keyof typeof data) => Object.prototype.hasOwnProperty.call(data, k);
    const ts = (v: string | null | undefined) => (v ? new Date(v) : null);
    const reg = ts(data.conviniRegisteredAt);
    const set = {
      gp: has("googlePostedAt"), gs: has("googleStars"), ls: has("conviniLinkSentAt"),
      rg: has("conviniRegisteredAt"), ct: has("contactedAt"), nt: has("notes"),
    };
    await sql()`
      INSERT INTO vip_followups (company_id, external_job_id, google_posted_at, google_stars, convini_link_sent_at,
        convini_registered_at, convini_registered_source, contacted_at, notes, updated_by)
      VALUES (${data.companyId}, ${data.jobId}, ${ts(data.googlePostedAt)}, ${data.googleStars ?? null}, ${ts(data.conviniLinkSentAt)},
        ${reg}, ${reg ? "staff" : null}, ${ts(data.contactedAt)}, ${data.notes?.trim() || null}, ${context.userId})
      ON CONFLICT (company_id, external_job_id) DO UPDATE SET
        google_posted_at = CASE WHEN ${set.gp} THEN EXCLUDED.google_posted_at ELSE vip_followups.google_posted_at END,
        google_stars = CASE WHEN ${set.gs} THEN EXCLUDED.google_stars ELSE vip_followups.google_stars END,
        convini_link_sent_at = CASE WHEN ${set.ls} THEN EXCLUDED.convini_link_sent_at ELSE vip_followups.convini_link_sent_at END,
        convini_registered_at = CASE WHEN ${set.rg} THEN EXCLUDED.convini_registered_at ELSE vip_followups.convini_registered_at END,
        convini_registered_source = CASE WHEN ${set.rg} THEN EXCLUDED.convini_registered_source ELSE vip_followups.convini_registered_source END,
        contacted_at = CASE WHEN ${set.ct} THEN EXCLUDED.contacted_at ELSE vip_followups.contacted_at END,
        notes = CASE WHEN ${set.nt} THEN EXCLUDED.notes ELSE vip_followups.notes END,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`;
    return { ok: true };
  });

/**
 * Public: the customer tapped "Continue to Google" on the thank-you screen.
 * Only counts for a fresh review that came through a GHL job link.
 */
export const trackGoogleClick = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ratingId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { sql } = await import("@/db/client.server");
    const { recordVipEvent } = await import("@/lib/vip-report.server");
    const [rating] = await sql()`
      SELECT r.company_id, rc.external_job_id
      FROM ratings r JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.id = ${data.ratingId} AND r.created_at > now() - interval '3 days'`;
    if (rating) await recordVipEvent(sql(), { companyId: rating.company_id, jobId: rating.external_job_id, event: "google_clicked" });
    return { ok: true };
  });

/** Assign one review day's customers to a follow-up person (null clears it). */
export const assignVipFollowupDay = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), day, staffId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const { assignVipDay } = await import("@/lib/vip-report.server");
    await assignVipDay(sql(), { ...data, userId: context.userId });
    return { ok: true };
  });

/** Reassign a single customer; null returns them to the day's person. */
export const assignVipFollowupCustomer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), jobId: z.string().trim().min(1).max(200), staffId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const [known] = await sql()`SELECT 1 FROM review_contexts WHERE company_id = ${data.companyId} AND external_job_id = ${data.jobId}`;
    if (!known) throw new Error("Job not found");
    const { assignVipCustomer } = await import("@/lib/vip-report.server");
    await assignVipCustomer(sql(), { ...data, userId: context.userId });
    return { ok: true };
  });

/** Add, rename, or turn on/off a follow-up person for this company. */
export const saveVipFollowupStaff = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60).optional(),
    active: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    try {
      if (!data.id) {
        if (!data.name) throw new Error("Enter a name");
        await sql()`
          INSERT INTO vip_followup_staff (company_id, name, sort_order)
          VALUES (${data.companyId}, ${data.name}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vip_followup_staff WHERE company_id = ${data.companyId}))`;
      } else {
        const updated = await sql()`
          UPDATE vip_followup_staff
          SET name = COALESCE(${data.name ?? null}, name), active = COALESCE(${data.active ?? null}, active)
          WHERE id = ${data.id} AND company_id = ${data.companyId}
          RETURNING id`;
        if (!updated.length) throw new Error("Not found");
      }
    } catch (error: any) {
      if (error?.code === "23505") throw new Error("That name is already on the list");
      throw error;
    }
    return { ok: true };
  });

/** Log a follow-up call: what happened, and when to call next (null = no more calls planned). */
export const logVipFollowupCall = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    jobId: z.string().trim().min(1).max(200),
    note: z.string().trim().max(2000).nullable().optional(),
    nextFollowupOn: day.nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const [known] = await sql()`SELECT 1 FROM review_contexts WHERE company_id = ${data.companyId} AND external_job_id = ${data.jobId}`;
    if (!known) throw new Error("Job not found");
    const { logVipCall } = await import("@/lib/vip-report.server");
    await logVipCall(sql(), { companyId: data.companyId, jobId: data.jobId, note: data.note?.trim() || null, nextFollowupOn: data.nextFollowupOn, userId: context.userId });
    return { ok: true };
  });

/** Change or clear the next follow-up date without logging a call. */
export const setVipNextFollowup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), jobId: z.string().trim().min(1).max(200), nextFollowupOn: day.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const [known] = await sql()`SELECT 1 FROM review_contexts WHERE company_id = ${data.companyId} AND external_job_id = ${data.jobId}`;
    if (!known) throw new Error("Job not found");
    await sql()`
      INSERT INTO vip_followups (company_id, external_job_id, next_followup_on, updated_by)
      VALUES (${data.companyId}, ${data.jobId}, ${data.nextFollowupOn}::date, ${context.userId})
      ON CONFLICT (company_id, external_job_id) DO UPDATE SET
        next_followup_on = EXCLUDED.next_followup_on, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    return { ok: true };
  });

/** Customer tapped a review-site button on the thank-you page. */
export const trackReviewSiteClick = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ratingId: z.string().uuid(), site: z.enum(REVIEW_SITE_IDS) }).parse(d))
  .handler(async ({ data }) => {
    const { sql } = await import("@/db/client.server");
    const db = sql();
    const [rating] = await db`
      SELECT r.company_id, rc.external_job_id
      FROM ratings r LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.id = ${data.ratingId} AND r.created_at > now() - interval '3 days'`;
    if (!rating) return { ok: true };
    await db`
      INSERT INTO review_site_clicks (company_id, rating_id, site)
      VALUES (${rating.company_id}, ${data.ratingId}, ${data.site})
      ON CONFLICT (rating_id, site) DO NOTHING`;
    if (data.site === "google" && rating.external_job_id) {
      const { recordVipEvent } = await import("@/lib/vip-report.server");
      await recordVipEvent(db, { companyId: rating.company_id, jobId: rating.external_job_id, event: "google_clicked" });
    }
    return { ok: true };
  });

async function loadGhlCreds(companyId: string) {
  const { sql } = await import("@/db/client.server");
  const [row] = await sql()`SELECT location_id, api_key_encrypted, api_key_last4 FROM company_ghl_settings WHERE company_id = ${companyId}`;
  if (!row) return null;
  const { decryptSecret } = await import("@/lib/secret-box.server");
  return { locationId: row.location_id as string, apiKey: decryptSecret(row.api_key_encrypted), last4: row.api_key_last4 as string };
}

/** Is texting through GoHighLevel set up for this company? Never returns the key. */
export const getGhlSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const [row] = await sql()`SELECT location_id, api_key_last4, updated_at FROM company_ghl_settings WHERE company_id = ${data.companyId}`;
    return row
      ? { connected: true, locationId: row.location_id as string, last4: row.api_key_last4 as string, updatedAt: new Date(row.updated_at).toISOString() }
      : { connected: false, locationId: null, last4: null, updatedAt: null };
  });

/** Save the company's GHL Location ID + Private Integration token, after checking them with GHL. */
export const saveGhlSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    locationId: z.string().trim().min(1).max(100),
    apiKey: z.string().trim().min(20).max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { ghlCheck } = await import("@/lib/ghl-api.server");
    await ghlCheck({ locationId: data.locationId, apiKey: data.apiKey });
    const { encryptSecret } = await import("@/lib/secret-box.server");
    const { sql } = await import("@/db/client.server");
    await sql()`
      INSERT INTO company_ghl_settings (company_id, location_id, api_key_encrypted, api_key_last4, updated_by)
      VALUES (${data.companyId}, ${data.locationId}, ${encryptSecret(data.apiKey)}, ${data.apiKey.slice(-4)}, ${context.userId})
      ON CONFLICT (company_id) DO UPDATE SET
        location_id = EXCLUDED.location_id, api_key_encrypted = EXCLUDED.api_key_encrypted,
        api_key_last4 = EXCLUDED.api_key_last4, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    return { ok: true };
  });

export const removeGhlSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    await sql()`DELETE FROM company_ghl_settings WHERE company_id = ${data.companyId}`;
    return { ok: true };
  });

/**
 * Fresh tip & review link for a customer. `send: false` previews which job it
 * will use and the text; `send: true` issues the link (the old one stops
 * working) and texts it through GHL, or returns it to copy if GHL isn't set up.
 */
export const textTipReviewLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    ratingId: z.string().uuid().optional(),
    phone: z.string().trim().max(40).optional(),
    name: z.string().trim().max(120).optional(),
    driverId: z.string().uuid().optional(),
    send: z.boolean(),
    message: z.string().trim().max(600).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const { planTipReviewLink, tipLinkMessage, issueTipReviewLink, recordTipLinkSent } = await import("@/lib/tip-link.server");
    const plan = await planTipReviewLink(sql(), data.companyId, { ratingId: data.ratingId, phone: data.phone, name: data.name, driverId: data.driverId });
    const creds = await loadGhlCreds(data.companyId);
    const preview = {
      jobId: plan.jobId, isNew: !plan.contextId, kind: plan.kind,
      customerName: plan.customerName, customerPhone: plan.customerPhone,
      driverName: plan.driverName, reviewedAt: plan.reviewedAt, stars: plan.stars, linkExpiresAt: plan.linkExpiresAt,
      ghlConnected: Boolean(creds),
    };
    if (!data.send) return { ...preview, message: tipLinkMessage(plan), sent: false, url: null as string | null, error: null as string | null };

    if (creds && !plan.ghlContactId && !plan.customerPhone) throw new Error("No phone number on file for this customer.");
    const template = data.message?.includes("{link}") ? data.message : `${data.message || tipLinkMessage(plan).replace(" {link}", "")} {link}`;
    const configured = process.env.APP_PUBLIC_URL?.trim();
    const origin = configured?.startsWith("https://") ? configured : "https://bluecollartips.app";
    const { url, jobId } = await issueTipReviewLink(sql(), data.companyId, plan, { origin });
    const text = template.replace("{link}", url);
    if (!creds) return { ...preview, jobId, message: text, sent: false, url, error: null };
    try {
      const { ghlUpsertContact, ghlSendSms } = await import("@/lib/ghl-api.server");
      const contactId = plan.ghlContactId ?? await ghlUpsertContact(creds, { name: plan.customerName, phone: plan.customerPhone! });
      await ghlSendSms(creds, contactId, text);
      await recordTipLinkSent(sql(), data.companyId, jobId, { userId: context.userId, ghlContactId: contactId });
      return { ...preview, jobId, message: text, sent: true, url, error: null };
    } catch (e) {
      // The new link exists either way; hand it back so staff can text it themselves.
      return { ...preview, jobId, message: text, sent: false, url, error: e instanceof Error ? e.message : "The text could not be sent." };
    }
  });
