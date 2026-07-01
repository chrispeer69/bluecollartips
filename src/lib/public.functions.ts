import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";
import { createHash } from "crypto";
import { getRequestHeader } from "@tanstack/react-start/server";

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX = 5;

function currentIpHash(): string {
  const fwd = getRequestHeader("x-forwarded-for") || getRequestHeader("cf-connecting-ip") || "unknown";
  const ip = String(fwd).split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function enforceRateLimit(driverId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ip_hash = currentIpHash();
  const bucket = new Date(Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
  const { data: existing } = await supabaseAdmin
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
  await supabaseAdmin
    .from("rating_rate_limits")
    .upsert(
      { ip_hash, driver_id: driverId, window_start: bucket, count: next },
      { onConflict: "ip_hash,driver_id,window_start" },
    );
}

export const getPublicDriver = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ companySlug: z.string().min(1), driverSlug: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug, logo_url, primary_color, secondary_color, support_email, google_review_url, yelp_review_url, facebook_review_url")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) return { company: null, driver: null };
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, display_name, slug, photo_url, status, venmo_handle, cashapp_handle, zelle_handle, paypal_handle")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .eq("status", "active")
      .maybeSingle();
    return { company, driver };
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
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    // Privileged insert path (no auth required on public page)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id, status")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .maybeSingle();
    if (!driver || driver.status !== "active") throw new Error("Driver not available");

    // Rate limit: max 5 submissions / IP / hour for this driver
    await enforceRateLimit(driver.id);

    const { data: rating, error: rErr } = await supabaseAdmin
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
      })
      .select("id")
      .single();
    if (rErr) throw rErr;

    // Phase 1: in-app tip payment is deferred (no Stripe). If the customer
    // indicated a P2P/cash tip, we log it as an unverified manual tip so the
    // driver's books reflect it; the driver and admin will reconcile.
    if (data.tipCents && data.tipSource && data.tipSource !== "stripe") {
      const { error: tErr } = await supabaseAdmin.from("tips").insert({
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
      await sendThankYou(supabaseAdmin, {
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
      await notifyEmployee(supabaseAdmin, {
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

    return { ok: true, ratingId: rating.id };
  });