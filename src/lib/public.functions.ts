import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";

function publicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const getPublicDriver = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ companySlug: z.string().min(1), driverSlug: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { data: company } = await supabase
      .from("companies")
      .select("id, name, slug, logo_url, primary_color, secondary_color, support_email")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) return { company: null, driver: null };
    const { data: driver } = await supabase
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

    const { data: rating, error: rErr } = await supabaseAdmin
      .from("ratings")
      .insert({
        company_id: company.id,
        driver_id: driver.id,
        stars: data.stars,
        feedback: data.feedback ?? null,
        customer_name: data.customerName ?? null,
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

    return { ok: true, ratingId: rating.id };
  });