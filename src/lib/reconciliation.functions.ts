import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listUnverifiedTips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!driver) return { items: [] };
    const { data } = await supabaseAdmin
      .from("tips")
      .select("id, amount_cents, source, customer_name, created_at, note")
      .eq("driver_id", driver.id)
      .eq("verified", false)
      .eq("disputed", false)
      .neq("source", "stripe")
      .order("created_at", { ascending: false })
      .limit(50);
    return { items: data ?? [] };
  });

export const confirmCashTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tip } = await supabaseAdmin
      .from("tips")
      .select("id, driver_id, amount_cents")
      .eq("id", data.tipId)
      .maybeSingle();
    if (!tip) throw new Error("Not found");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("user_id")
      .eq("id", tip.driver_id)
      .maybeSingle();
    if (driver?.user_id !== context.userId) throw new Error("Forbidden");
    await supabaseAdmin
      .from("tips")
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq("id", tip.id);
    await supabaseAdmin.from("cash_tip_verifications").insert({
      company_id: tip.company_id,
      tip_id: tip.id,
      driver_id: tip.driver_id,
      confirmed_by: context.userId,
      confirmed_amount_cents: tip.amount_cents,
      outcome: "confirmed",
    });
    return { ok: true };
  });

export const disputeCashTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tipId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tip } = await supabaseAdmin
      .from("tips")
      .select("id, driver_id, company_id")
      .eq("id", data.tipId)
      .maybeSingle();
    if (!tip) throw new Error("Not found");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("user_id")
      .eq("id", tip.driver_id)
      .maybeSingle();
    if (driver?.user_id !== context.userId) throw new Error("Forbidden");
    await supabaseAdmin
      .from("tips")
      .update({ disputed: true, disputed_at: new Date().toISOString() })
      .eq("id", tip.id);
    await supabaseAdmin.from("discrepancy_flags").insert({
      company_id: tip.company_id,
      driver_id: tip.driver_id,
      tip_id: tip.id,
      reason: "driver_dispute",
      status: "open",
      notes: data.reason ?? "Driver disputed this tip",
    });
    return { ok: true };
  });

/** Admin view: drivers with > 20% unverified share in last 30 days, plus per-driver counts. */
export const reconciliationOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", context.userId);
    const ok = roles?.some(
      (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === data.companyId),
    );
    if (!ok) throw new Error("Forbidden");

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tips } = await supabaseAdmin
      .from("tips")
      .select("driver_id, source, verified, amount_cents, created_at")
      .eq("company_id", data.companyId)
      .gte("created_at", since);

    const map = new Map<
      string,
      { total: number; manual: number; unverified: number; amountUnverified: number }
    >();
    for (const t of tips ?? []) {
      const m = map.get(t.driver_id) ?? { total: 0, manual: 0, unverified: 0, amountUnverified: 0 };
      m.total += 1;
      if (t.source !== "stripe") {
        m.manual += 1;
        if (!t.verified) {
          m.unverified += 1;
          m.amountUnverified += t.amount_cents;
        }
      }
      map.set(t.driver_id, m);
    }

    const rows = Array.from(map.entries()).map(([driverId, m]) => ({
      driverId,
      ...m,
      unverifiedPct: m.total ? Math.round((m.unverified / m.total) * 100) : 0,
    }));
    return { rows };
  });