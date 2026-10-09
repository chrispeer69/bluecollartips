// Staff-sent fresh tip & review links (VIP report → "Text new link").
// Kept free of app aliases so tests can import it directly.
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { hashReviewToken, newReviewToken } from "./review-webhooks.server.ts";

export type TipLinkTarget = {
  /** A VIP report row: re-send for that customer's job. */
  ratingId?: string | null;
  /** Otherwise find the customer's most recent job by phone. */
  phone?: string | null;
  name?: string | null;
  /** Driver for a brand-new link, or a job that has no driver yet. */
  driverId?: string | null;
};

export type TipLinkPlan = {
  /** null = no past job for this customer; a new link will be created. */
  contextId: string | null;
  jobId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  ghlContactId: string | null;
  driverId: string | null;
  driverName: string | null;
  driverSlug: string | null;
  /** review = the full rate-then-tip flow; tip = already reviewed, go straight to the tip. */
  kind: "review" | "tip";
  tipRatingId: string | null;
  reviewedAt: string | null;
  stars: number | null;
  linkExpiresAt: string | null;
  companySlug: string;
  companyName: string;
};

const digits10 = (value?: string | null) => {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

export async function planTipReviewLink(sql: Sql, companyId: string, target: TipLinkTarget): Promise<TipLinkPlan> {
  const [company] = await sql`SELECT slug, name FROM companies WHERE id = ${companyId}`;
  if (!company) throw new Error("Company not found");
  const phone = digits10(target.phone);
  let ctx: any;
  if (target.ratingId) {
    [ctx] = await sql`
      SELECT rc.id FROM ratings r JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.id = ${target.ratingId} AND r.company_id = ${companyId}`;
    if (!ctx) throw new Error("Customer not found");
  } else if (phone) {
    [ctx] = await sql`
      SELECT rc.id FROM review_contexts rc
      WHERE rc.company_id = ${companyId}
        AND (right(regexp_replace(coalesce(rc.customer_phone, ''), '\\D', '', 'g'), 10) = ${phone}
          OR EXISTS (SELECT 1 FROM ratings r WHERE r.review_context_id = rc.id
                     AND right(regexp_replace(coalesce(r.customer_phone, ''), '\\D', '', 'g'), 10) = ${phone}))
      ORDER BY rc.created_at DESC
      LIMIT 1`;
  } else {
    throw new Error("Enter the customer's 10-digit phone number.");
  }

  const driverById = async (id: string | null) => {
    if (!id) return null;
    const [d] = await sql`SELECT id, display_name, slug FROM drivers WHERE id = ${id} AND company_id = ${companyId} AND status = 'active'`;
    return d ?? null;
  };
  const base = { companySlug: company.slug as string, companyName: company.name as string };

  if (!ctx) {
    const driver = await driverById(target.driverId ?? null);
    if (target.driverId && !driver) throw new Error("That driver isn't active.");
    return {
      ...base, contextId: null, jobId: null, kind: "review", tipRatingId: null, reviewedAt: null, stars: null, linkExpiresAt: null,
      customerName: target.name?.trim() || null, customerPhone: target.phone?.trim() || null, ghlContactId: null,
      driverId: driver?.id ?? null, driverName: driver?.display_name ?? null, driverSlug: driver?.slug ?? null,
    };
  }

  const [c] = await sql`
    SELECT rc.id, rc.external_job_id, rc.external_contact_id, rc.driver_id, rc.consumed_at, rc.rating_id, rc.expires_at,
           COALESCE(NULLIF(BTRIM(cr.customer_name), ''), rc.customer_name) AS customer_name,
           COALESCE(NULLIF(BTRIM(cr.customer_phone), ''), rc.customer_phone) AS customer_phone,
           cr.driver_id AS rating_driver_id, cr.created_at AS reviewed_at, cr.stars
    FROM review_contexts rc
    LEFT JOIN ratings cr ON cr.id = rc.rating_id
    WHERE rc.id = ${ctx.id}`;
  const reviewed = Boolean(c.consumed_at && c.rating_id);
  let driver;
  if (reviewed) {
    // The tip step only opens for the review's own driver.
    driver = await driverById(c.rating_driver_id);
    if (!driver) {
      throw new Error(c.rating_driver_id
        ? "This customer already reviewed, but that driver is no longer active, so there's no one to tip."
        : "This customer already reviewed the company, but the review isn't assigned to a driver yet. Assign it to a driver (Ratings tab), then send the tip link.");
    }
  } else {
    driver = await driverById(c.driver_id ?? target.driverId ?? null);
  }
  return {
    ...base,
    contextId: c.id,
    jobId: c.external_job_id,
    customerName: c.customer_name ?? (target.name?.trim() || null),
    customerPhone: c.customer_phone ?? (target.phone?.trim() || null),
    ghlContactId: c.external_contact_id ?? null,
    driverId: driver?.id ?? null,
    driverName: driver?.display_name ?? null,
    driverSlug: driver?.slug ?? null,
    kind: reviewed ? "tip" : "review",
    tipRatingId: reviewed ? c.rating_id : null,
    reviewedAt: c.reviewed_at ? new Date(c.reviewed_at).toISOString() : null,
    stars: c.stars ?? null,
    linkExpiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null,
  };
}

/** Default text; `{link}` is replaced with the new URL. */
export function tipLinkMessage(plan: TipLinkPlan) {
  const first = plan.customerName?.trim().split(/\s+/)[0] || "there";
  if (plan.kind === "tip") {
    return `Hi ${first}, thanks again for your review of ${plan.companyName}! Here's your new link to leave ${plan.driverName} a tip: {link}`;
  }
  return `Hi ${first}, here's your new link from ${plan.companyName} to rate your service${plan.driverName ? ` with ${plan.driverName}` : ""} and leave a tip: {link}`;
}

/**
 * Issue a fresh token for the plan's job (or a new job), good for `days`.
 * The old link stops working. A reviewed job keeps its review; the new link
 * opens the tip step for it.
 */
export async function issueTipReviewLink(sql: Sql, companyId: string, plan: TipLinkPlan, opts: { origin: string; days?: number }) {
  const token = newReviewToken();
  const days = opts.days ?? 10;
  let jobId = plan.jobId;
  if (plan.contextId) {
    await sql`
      UPDATE review_contexts
      SET token_hash = ${hashReviewToken(token)},
          expires_at = now() + make_interval(days => ${days}),
          -- A tip link must match the review's driver (it may have been reassigned since).
          driver_id = CASE WHEN ${plan.kind === "tip"} THEN ${plan.driverId}::uuid ELSE COALESCE(driver_id, ${plan.driverId}::uuid) END
      WHERE id = ${plan.contextId} AND company_id = ${companyId}`;
  } else {
    jobId = `manual-${randomUUID().slice(0, 8)}`;
    await sql`
      INSERT INTO review_contexts (company_id, driver_id, token_hash, external_job_id, expires_at, customer_name, customer_phone)
      VALUES (${companyId}, ${plan.driverId}, ${hashReviewToken(token)}, ${jobId}, now() + make_interval(days => ${days}),
              ${plan.customerName}, ${plan.customerPhone})`;
  }
  const origin = opts.origin.replace(/\/$/, "");
  const co = encodeURIComponent(plan.companySlug);
  const path = plan.driverSlug ? `/${co}/d/${encodeURIComponent(plan.driverSlug)}` : `/${co}`;
  const params = new URLSearchParams({ t: token });
  if (plan.kind === "tip" && plan.tipRatingId) { params.set("tip", "1"); params.set("r", plan.tipRatingId); }
  return { url: `${origin}${path}?${params.toString()}`, jobId: jobId! };
}

/** Remember the text went out, and the GHL contact it went to. */
export async function recordTipLinkSent(sql: Sql, companyId: string, jobId: string, args: { userId: string | null; ghlContactId: string | null }) {
  await sql`
    INSERT INTO vip_followups (company_id, external_job_id, link_resent_at, link_resent_count, updated_by)
    VALUES (${companyId}, ${jobId}, now(), 1, ${args.userId})
    ON CONFLICT (company_id, external_job_id) DO UPDATE SET
      link_resent_at = now(), link_resent_count = vip_followups.link_resent_count + 1,
      updated_by = EXCLUDED.updated_by, updated_at = now()`;
  if (args.ghlContactId) {
    await sql`
      UPDATE review_contexts SET external_contact_id = ${args.ghlContactId}
      WHERE company_id = ${companyId} AND external_job_id = ${jobId} AND external_contact_id IS NULL`;
  }
}
