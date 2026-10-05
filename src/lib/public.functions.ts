import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { getRequestHeader } from "@tanstack/react-start/server";
import { deliverReviewWebhook, hashReviewToken } from "./review-webhooks.server";

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 3;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const qualityBadges = z.array(z.enum(["quick", "professional", "communication", "care", "reassuring", "handoff"])).max(6);

function currentIpHash(): string {
  const fwd = getRequestHeader("x-forwarded-for") || getRequestHeader("cf-connecting-ip") || "unknown";
  const ip = String(fwd).split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function enforceRateLimit(driverId: string) {
  const { db } = await import("@/db/client.server");
  const ip_hash = currentIpHash();
  const bucket = new Date(Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
  const { data: existing } = await db
    .from("rating_rate_limits")
    .select("count")
    .eq("ip_hash", ip_hash)
    .eq("driver_id", driverId)
    .eq("window_start", bucket)
    .maybeSingle();
  const next = (existing?.count ?? 0) + 1;
  if (next > RATE_MAX) {
    throw new Error("Too many submissions from your network. Please try again later.");
  }
  await db
    .from("rating_rate_limits")
    .upsert(
      { ip_hash, driver_id: driverId, window_start: bucket, count: next },
      { onConflict: "ip_hash,driver_id,window_start" },
    );
}

async function enforceCompanyRateLimit(companyId: string) {
  const { db } = await import("@/db/client.server");
  const ip_hash = currentIpHash();
  const bucket = new Date(Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
  const { data: existing } = await db.from("company_rating_rate_limits").select("count")
    .eq("ip_hash", ip_hash).eq("company_id", companyId).eq("window_start", bucket).maybeSingle();
  const next = (existing?.count ?? 0) + 1;
  if (next > RATE_MAX) throw new Error("Too many submissions from your network. Please try again later.");
  await db.from("company_rating_rate_limits").upsert(
    { ip_hash, company_id: companyId, window_start: bucket, count: next },
    { onConflict: "ip_hash,company_id,window_start" },
  );
}

const PUBLIC_COMPANY_FIELDS = "id, name, slug, logo_url, primary_color, secondary_color, support_email, positive_rating_threshold, review_badges_enabled, google_review_url, facebook_review_url, yelp_review_url, apple_maps_review_url, bing_review_url, usta_review_url, enabled_review_sites";

/** Why a job-specific review link can't be used, for an honest message on the page. */
export type ReviewLinkIssue = "used" | "expired" | "invalid" | "other_employee";

async function inspectReviewContext(
  db: any,
  token: string | null | undefined,
  companyId: string,
  driverId?: string | null,
  submittedRatingId?: string | null,
): Promise<{ context: any | null; issue: ReviewLinkIssue | null }> {
  if (!token) return { context: null, issue: null };
  try {
    return { context: await resolveReviewContext(db, token, companyId, driverId, submittedRatingId), issue: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("different employee")) return { context: null, issue: "other_employee" };
    const { data: context } = await db.from("review_contexts")
      .select("consumed_at, expires_at")
      .eq("token_hash", hashReviewToken(token)).eq("company_id", companyId).maybeSingle();
    if (!context) return { context: null, issue: "invalid" };
    if (context.consumed_at) return { context: null, issue: "used" };
    return { context: null, issue: "expired" };
  }
}

async function resolveReviewContext(
  db: any,
  token: string | null | undefined,
  companyId: string,
  driverId?: string | null,
  submittedRatingId?: string | null,
) {
  if (!token) return null;
  const { data: context } = await db.from("review_contexts")
    .select("id, driver_id, external_job_id, external_contact_id, customer_name, customer_phone, customer_email, dispatch_driver_name, expires_at, consumed_at, rating_id")
    .eq("token_hash", hashReviewToken(token)).eq("company_id", companyId).maybeSingle();
  const validSubmittedReview = Boolean(
    submittedRatingId && context?.rating_id === submittedRatingId,
  );
  if (!context || (context.consumed_at && !validSubmittedReview) || new Date(context.expires_at).getTime() <= Date.now()) {
    throw new Error("This review link is invalid, expired, or has already been used.");
  }
  if (driverId && context.driver_id && context.driver_id !== driverId) {
    throw new Error("This review link is for a different employee. Please use the latest link from your service provider.");
  }
  return context;
}

export const getPublicCompany = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ companySlug: z.string().min(1), reviewToken: z.string().trim().min(20).max(200).optional().nullable() }).parse(data))
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: company } = await db.from("companies").select(PUBLIC_COMPANY_FIELDS)
      .eq("slug", data.companySlug).eq("status", "active").maybeSingle();
    if (!company) return null;
    const { context, issue } = await inspectReviewContext(db, data.reviewToken, company.id);
    return { ...company, linkIssue: issue, reviewContact: context ? {
      name: context.customer_name ?? null,
      phone: context.customer_phone ?? null,
      email: context.customer_email ?? null,
    } : null };
  });

export const getPublicDriver = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({
      companySlug: z.string().min(1),
      driverSlug: z.string().min(1),
      reviewToken: z.string().trim().min(20).max(200).optional().nullable(),
      submittedRatingId: z.string().uuid().optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select(PUBLIC_COMPANY_FIELDS)
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) return {
      company: null,
      driver: null,
      reviewContact: null,
      submittedReview: null,
      tipAlreadyReceived: false,
      linkIssue: null as ReviewLinkIssue | null,
    };
    const { data: driver } = await db
      .from("drivers")
      .select("id, display_name, slug, photo_url, status")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .eq("status", "active")
      .maybeSingle();
    const { context, issue: linkIssue } = driver
      ? await inspectReviewContext(
          db,
          data.reviewToken,
          company.id,
          driver.id,
          data.submittedRatingId,
        )
      : { context: null, issue: null };
    let submittedReview: {
      id: string;
      stars: number;
      feedback: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      customer_email: string | null;
    } | null = null;
    let tipAlreadyReceived = false;
    if (context && data.submittedRatingId) {
      const { data: rating } = await db.from("ratings")
        .select("id, stars, feedback, customer_name, customer_phone, customer_email")
        .eq("id", data.submittedRatingId)
        .eq("company_id", company.id)
        .eq("driver_id", driver.id)
        .maybeSingle();
      if (!rating) throw new Error("This tip link is not valid.");
      submittedReview = rating;
      const { data: paidTip } = await db.from("tips")
        .select("id")
        .eq("rating_id", rating.id)
        .eq("verified", true)
        .maybeSingle();
      tipAlreadyReceived = Boolean(paidTip);
    }
    return { company, driver, reviewContact: context ? {
      name: context.customer_name ?? null,
      phone: context.customer_phone ?? null,
      email: context.customer_email ?? null,
    } : null, submittedReview, tipAlreadyReceived, linkIssue };
  });

export const submitRating = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        companySlug: z.string().min(1),
        driverSlug: z.string().min(1),
        stars: z.number().int().min(1).max(5),
        feedback: z.string().trim().max(2000).optional().nullable(),
        qualityBadges,
        customerName: z.string().trim().max(120).optional().nullable(),
        customerPhone: z.string().trim().max(40).optional().nullable(),
        customerEmail: z.string().trim().max(200).optional().nullable(),
        reviewToken: z.string().trim().min(20).max(200).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    // Privileged insert path (no auth required on public page)
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select("id, review_badges_enabled, review_webhook_enabled, review_webhook_url, review_webhook_secret_encrypted")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    if (data.customerEmail && !EMAIL_PATTERN.test(data.customerEmail)) {
      throw new Error("Please enter a valid email address.");
    }
    const { data: driver } = await db
      .from("drivers")
      .select("id, display_name, status")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .maybeSingle();
    if (!driver || driver.status !== "active") throw new Error("Driver not available");
    const reviewContext = await resolveReviewContext(db, data.reviewToken, company.id, driver.id);

    // Rate limit: max 3 submissions / IP / 5 minutes for this driver page.
    await enforceRateLimit(driver.id);

    const { data: rating, error: rErr } = await db
      .from("ratings")
      .insert({
        company_id: company.id,
        driver_id: driver.id,
        stars: data.stars,
        feedback: data.feedback ?? null,
        quality_badges: company.review_badges_enabled ? data.qualityBadges : [],
        customer_name: data.customerName ?? null,
        customer_phone: data.customerPhone ?? null,
        customer_email: data.customerEmail ?? null,
        flagged: data.stars <= 2,
        review_context_id: reviewContext?.id ?? null,
        // The rating form shows the public-review notice before submit.
        public_ok: true,
      })
      .select("id")
      .single();
    if (rErr) throw rErr;
    if (reviewContext) await db.from("review_contexts").update({ consumed_at: new Date().toISOString(), rating_id: rating.id }).eq("id", reviewContext.id);

    const appOrigin = (process.env.APP_PUBLIC_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
    const tipUrl = reviewContext && data.reviewToken && data.stars >= 4
      ? `${appOrigin}/${encodeURIComponent(data.companySlug)}/d/${encodeURIComponent(data.driverSlug)}?${new URLSearchParams({ t: data.reviewToken, tip: "1", r: rating.id }).toString()}`
      : null;

    // Stripe records online tips independently. This public endpoint records
    // only the rating; cash and external tips must be logged by an employee.
    try {
      const { notifyEmployee } = await import("@/lib/notify.server");
      await notifyEmployee(db, {
        companyId: company.id,
        driverId: driver.id,
        kind: "rating",
        amountCents: null,
        stars: data.stars,
        customerName: data.customerName ?? null,
      });
    } catch (e) {
      console.error("employee notify failed", e);
    }

    await deliverReviewWebhook(db, company, {
      event: "review.submitted", ratingId: rating.id, companySlug: data.companySlug,
      jobId: reviewContext?.external_job_id ?? null, ghlContactId: reviewContext?.external_contact_id ?? null,
      driverId: driver.id, driverName: driver.display_name, driverSlug: data.driverSlug, stars: data.stars,
      feedback: data.feedback ?? null, tipUrl, customerName: data.customerName ?? null,
      customerPhone: data.customerPhone ?? null, customerEmail: data.customerEmail ?? null,
      submittedAt: new Date().toISOString(),
    });

    return { ok: true, ratingId: rating.id };
  });

export const submitCompanyRating = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({
    companySlug: z.string().min(1),
    stars: z.number().int().min(1).max(5),
    feedback: z.string().trim().max(2000).optional().nullable(),
    qualityBadges,
    customerName: z.string().trim().max(120).optional().nullable(),
    customerPhone: z.string().trim().max(40).optional().nullable(),
    customerEmail: z.string().trim().max(200).optional().nullable(),
    reviewToken: z.string().trim().min(20).max(200).optional().nullable(),
  }).parse(data))
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: company } = await db.from("companies")
      .select("id, review_badges_enabled, review_webhook_enabled, review_webhook_url, review_webhook_secret_encrypted")
      .eq("slug", data.companySlug).eq("status", "active").maybeSingle();
    if (!company) throw new Error("Company not found");
    if (data.customerEmail && !EMAIL_PATTERN.test(data.customerEmail)) {
      throw new Error("Please enter a valid email address.");
    }
    const reviewContext = await resolveReviewContext(db, data.reviewToken, company.id, null);
    await enforceCompanyRateLimit(company.id);
    const { data: rating, error } = await db.from("ratings").insert({
      company_id: company.id, driver_id: null, stars: data.stars,
      feedback: data.feedback ?? null, quality_badges: company.review_badges_enabled ? data.qualityBadges : [], customer_name: data.customerName ?? null,
      customer_phone: data.customerPhone ?? null, customer_email: data.customerEmail ?? null,
      flagged: data.stars <= 2,
      review_context_id: reviewContext?.id ?? null,
      // The rating form shows the public-review notice before submit.
      public_ok: true,
    }).select("id").single();
    if (error) throw error;
    if (reviewContext) await db.from("review_contexts").update({ consumed_at: new Date().toISOString(), rating_id: rating.id }).eq("id", reviewContext.id);
    await deliverReviewWebhook(db, company, {
      event: "review.submitted", ratingId: rating.id, companySlug: data.companySlug,
      jobId: reviewContext?.external_job_id ?? null, ghlContactId: reviewContext?.external_contact_id ?? null,
      driverId: null, driverName: reviewContext?.dispatch_driver_name ?? null, driverSlug: null,
      // Company-level pages do not have a verified driver to pay. Do not send
      // a follow-up payment link until an admin has attributed the review.
      stars: data.stars, feedback: data.feedback ?? null, tipUrl: null,
      customerName: data.customerName ?? null, customerPhone: data.customerPhone ?? null,
      customerEmail: data.customerEmail ?? null, submittedAt: new Date().toISOString(),
    });
    return { ok: true, ratingId: rating.id };
  });
