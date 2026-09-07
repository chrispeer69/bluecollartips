import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";
import { createHash } from "crypto";
import { getRequestHeader } from "@tanstack/react-start/server";
import { deliverReviewWebhook, hashReviewToken } from "./review-webhooks.server";

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 3;

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

const PUBLIC_COMPANY_FIELDS = "id, name, slug, logo_url, primary_color, secondary_color, support_email, google_review_url, yelp_review_url, facebook_review_url, positive_rating_threshold, positive_submit_action, positive_redirect_url";

async function resolveReviewContext(db: any, token: string | null | undefined, companyId: string, driverId?: string | null) {
  if (!token) return null;
  const { data: context } = await db.from("review_contexts")
    .select("id, driver_id, external_job_id, external_contact_id, expires_at, consumed_at")
    .eq("token_hash", hashReviewToken(token)).eq("company_id", companyId).maybeSingle();
  if (!context || context.consumed_at || new Date(context.expires_at).getTime() <= Date.now()) {
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
    const context = await resolveReviewContext(db, data.reviewToken, company.id);
    return { ...company, reviewContact: context ? {
      name: context.customer_name ?? null,
      phone: context.customer_phone ?? null,
      email: context.customer_email ?? null,
    } : null };
  });

export const getPublicDriver = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ companySlug: z.string().min(1), driverSlug: z.string().min(1), reviewToken: z.string().trim().min(20).max(200).optional().nullable() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select(PUBLIC_COMPANY_FIELDS)
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) return { company: null, driver: null };
    const { data: driver } = await db
      .from("drivers")
      .select("id, display_name, slug, photo_url, status, venmo_handle, cashapp_handle, zelle_handle, paypal_handle")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .eq("status", "active")
      .maybeSingle();
    const context = driver ? await resolveReviewContext(db, data.reviewToken, company.id, driver.id) : null;
    return { company, driver, reviewContact: context ? {
      name: context.customer_name ?? null,
      phone: context.customer_phone ?? null,
      email: context.customer_email ?? null,
    } : null };
  });

export const submitRating = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        companySlug: z.string().min(1),
        driverSlug: z.string().min(1),
        stars: z.number().int().min(1).max(5),
        feedback: z.string().trim().max(2000).optional().nullable(),
        customerName: z.string().trim().max(120).optional().nullable(),
        customerPhone: z.string().trim().max(40).optional().nullable(),
        customerEmail: z.string().trim().email().max(200).optional().nullable(),
        tipCents: z
          .number()
          .int()
          .min(TIP_MIN_CENTS)
          .max(TIP_MAX_CENTS)
          .optional()
          .nullable(),
        tipSource: z
          .enum(["stripe", "venmo", "cashapp", "zelle", "paypal", "cash", "other"])
          .optional()
          .nullable(),
        reviewToken: z.string().trim().min(20).max(200).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    // Privileged insert path (no auth required on public page)
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select("id, positive_rating_threshold, positive_submit_action, positive_redirect_url, review_webhook_enabled, review_webhook_url, review_webhook_secret_encrypted")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    const { data: driver } = await db
      .from("drivers")
      .select("id, status")
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
        customer_name: data.customerName ?? null,
        customer_phone: data.customerPhone ?? null,
        customer_email: data.customerEmail ?? null,
        flagged: data.stars <= 2,
        review_context_id: reviewContext?.id ?? null,
      })
      .select("id")
      .single();
    if (rErr) throw rErr;
    if (reviewContext) await db.from("review_contexts").update({ consumed_at: new Date().toISOString(), rating_id: rating.id }).eq("id", reviewContext.id);

    // Phase 1: in-app tip payment is deferred (no Stripe). If the customer
    // indicated a P2P/cash tip, we log it as an unverified manual tip so the
    // driver's books reflect it; the driver and admin will reconcile.
    if (data.tipCents && data.tipSource && data.tipSource !== "stripe") {
      const { error: tErr } = await db.from("tips").insert({
        company_id: company.id,
        driver_id: driver.id,
        rating_id: rating.id,
        amount_cents: data.tipCents,
        source: data.tipSource,
        customer_name: data.customerName ?? null,
        // split columns are NOT NULL; trigger will overwrite. Pass 0 placeholders.
        driver_amount_cents: 0,
        company_amount_cents: 0,
        platform_amount_cents: 0,
        note: "Customer-reported P2P tip (awaiting driver confirmation)",
      });
      if (tErr) throw tErr;
    }

    // Fire-and-await thank-you notifications (per-company templates).
    try {
      const { sendThankYou } = await import("@/lib/thankyou.server");
      await sendThankYou(db, {
        companyId: company.id,
        driverId: driver.id,
        ratingId: rating.id,
        stars: data.stars,
        tipCents: data.tipCents ?? null,
        customerName: data.customerName ?? null,
        customerPhone: data.customerPhone ?? null,
        customerEmail: data.customerEmail ?? null,
      });
    } catch (e) {
      console.error("thank-you send failed", e);
    }

    // Notify the employee (SMS) about the new rating/tip.
    try {
      const { notifyEmployee } = await import("@/lib/notify.server");
      await notifyEmployee(db, {
        companyId: company.id,
        driverId: driver.id,
        kind: data.tipCents && data.tipCents > 0 ? "tip" : "rating",
        amountCents: data.tipCents ?? null,
        stars: data.stars,
        customerName: data.customerName ?? null,
      });
    } catch (e) {
      console.error("employee notify failed", e);
    }

    await deliverReviewWebhook(db, company, {
      event: "review.submitted", ratingId: rating.id, companySlug: data.companySlug,
      jobId: reviewContext?.external_job_id ?? null, ghlContactId: reviewContext?.external_contact_id ?? null,
      driverId: driver.id, driverSlug: data.driverSlug, stars: data.stars,
      feedback: data.feedback ?? null, customerName: data.customerName ?? null,
      customerPhone: data.customerPhone ?? null, customerEmail: data.customerEmail ?? null,
      submittedAt: new Date().toISOString(),
    });

    const redirectUrl = data.stars >= company.positive_rating_threshold &&
      company.positive_submit_action === "redirect" ? company.positive_redirect_url : null;
    return { ok: true, ratingId: rating.id, redirectUrl };
  });

export const submitCompanyRating = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({
    companySlug: z.string().min(1),
    stars: z.number().int().min(1).max(5),
    feedback: z.string().trim().max(2000).optional().nullable(),
    customerName: z.string().trim().max(120).optional().nullable(),
    customerPhone: z.string().trim().max(40).optional().nullable(),
    customerEmail: z.string().trim().email().max(200).optional().nullable(),
    reviewToken: z.string().trim().min(20).max(200).optional().nullable(),
  }).parse(data))
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: company } = await db.from("companies")
      .select("id, positive_rating_threshold, positive_submit_action, positive_redirect_url, review_webhook_enabled, review_webhook_url, review_webhook_secret_encrypted")
      .eq("slug", data.companySlug).eq("status", "active").maybeSingle();
    if (!company) throw new Error("Company not found");
    const reviewContext = await resolveReviewContext(db, data.reviewToken, company.id, null);
    await enforceCompanyRateLimit(company.id);
    const { data: rating, error } = await db.from("ratings").insert({
      company_id: company.id, driver_id: null, stars: data.stars,
      feedback: data.feedback ?? null, customer_name: data.customerName ?? null,
      customer_phone: data.customerPhone ?? null, customer_email: data.customerEmail ?? null,
      flagged: data.stars <= 2,
      review_context_id: reviewContext?.id ?? null,
    }).select("id").single();
    if (error) throw error;
    if (reviewContext) await db.from("review_contexts").update({ consumed_at: new Date().toISOString(), rating_id: rating.id }).eq("id", reviewContext.id);
    await deliverReviewWebhook(db, company, {
      event: "review.submitted", ratingId: rating.id, companySlug: data.companySlug,
      jobId: reviewContext?.external_job_id ?? null, ghlContactId: reviewContext?.external_contact_id ?? null,
      driverId: null, driverSlug: null, stars: data.stars, feedback: data.feedback ?? null,
      customerName: data.customerName ?? null, customerPhone: data.customerPhone ?? null,
      customerEmail: data.customerEmail ?? null, submittedAt: new Date().toISOString(),
    });
    const redirectUrl = data.stars >= company.positive_rating_threshold &&
      company.positive_submit_action === "redirect" ? company.positive_redirect_url : null;
    return { ok: true, ratingId: rating.id, redirectUrl };
  });
