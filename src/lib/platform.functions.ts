import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertSuper(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const platformOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: tenants }, { data: tips }, { count: drivers }] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id, name, slug, status, created_at, primary_color")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("tips")
        .select("amount_cents, company_amount_cents, platform_amount_cents, company_id, source, verified, created_at"),
      supabaseAdmin.from("drivers").select("*", { count: "exact", head: true }),
    ]);

    const byCompany = new Map<string, { gross: number; companyShare: number; platformShare: number; count: number; pendingCompany: number }>();
    let platformTotal = 0;
    let grossTotal = 0;
    for (const t of tips ?? []) {
      const m = byCompany.get(t.company_id) ?? { gross: 0, companyShare: 0, platformShare: 0, count: 0, pendingCompany: 0 };
      m.gross += t.amount_cents;
      m.companyShare += t.company_amount_cents;
      m.platformShare += t.platform_amount_cents;
      m.count += 1;
      // Card tips routed via Stripe — company share is held in platform balance pending sweep
      if (t.source !== "stripe") m.pendingCompany += t.company_amount_cents;
      byCompany.set(t.company_id, m);
      platformTotal += t.platform_amount_cents;
      grossTotal += t.amount_cents;
    }

    return {
      tenants: (tenants ?? []).map((c) => ({ ...c, ...(byCompany.get(c.id) ?? { gross: 0, companyShare: 0, platformShare: 0, count: 0, pendingCompany: 0 }) })),
      platformTotal,
      grossTotal,
      driverCount: drivers ?? 0,
      integrations: {
        stripe: !!process.env.STRIPE_SECRET_KEY,
        twilio: !!(process.env.TWILIO_API_KEY && process.env.TWILIO_FROM_NUMBER),
      },
    };
  });

export const suspendTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ companyId: z.string().uuid(), status: z.enum(["active", "suspended"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("companies").update({ status: data.status }).eq("id", data.companyId);
    return { ok: true };
  });