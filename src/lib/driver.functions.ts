import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";

export const getDriverDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: driver } = await supabase
      .from("drivers")
      .select("*, companies(name, slug, primary_color, secondary_color, logo_url)")
      .eq("user_id", userId)
      .maybeSingle();
    if (!driver) return { driver: null, ratings: [], tips: [], flags: [] };
    const [{ data: ratings }, { data: tips }, { data: flags }] = await Promise.all([
      supabase
        .from("ratings")
        .select("id, stars, feedback, customer_name, created_at, flagged")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("tips")
        .select(
          "id, amount_cents, source, customer_name, driver_amount_cents, company_amount_cents, platform_amount_cents, created_at, note",
        )
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("discrepancy_flags")
        .select("id, reason, status, notes, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false }),
    ]);
    return { driver, ratings: ratings ?? [], tips: tips ?? [], flags: flags ?? [] };
  });

export const logManualTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        amountCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
        source: z.enum(["cash", "venmo", "cashapp", "zelle", "paypal", "other"]),
        customerName: z.string().trim().max(120).optional().nullable(),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: driver } = await supabase
      .from("drivers")
      .select("id, company_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!driver) throw new Error("No driver profile");
    if (driver.status !== "active") throw new Error("Driver account not active");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tips").insert({
      company_id: driver.company_id,
      driver_id: driver.id,
      amount_cents: data.amountCents,
      source: data.source,
      customer_name: data.customerName ?? null,
      note: data.note ?? null,
      logged_by: userId,
      driver_amount_cents: 0,
      company_amount_cents: 0,
      platform_amount_cents: 0,
    });
    if (error) throw error;
    return { ok: true };
  });