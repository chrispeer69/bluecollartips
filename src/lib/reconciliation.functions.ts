import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

async function canAccessDriver(userId: string, driver: { user_id: string | null; company_id: string }) {
  if (driver.user_id === userId) return true;
  const { db } = await import("@/db/client.server");
  const { data: roles } = await db
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  return roles?.some(
    (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === driver.company_id),
  ) ?? false;
}

export const listUnverifiedTips = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid().optional() }).optional().parse(d))
  .handler(async ({ data: input, context }) => {
    const { db } = await import("@/db/client.server");
    let query = db
      .from("drivers")
      .select("id, user_id, company_id")
      .limit(1);
    query = input?.driverId ? query.eq("id", input.driverId) : query.eq("user_id", context.userId);
    const { data: driver } = await query.maybeSingle();
    if (!driver) return { items: [] };
    if (!(await canAccessDriver(context.userId, driver))) return { items: [] };
    const { data } = await db
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
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ tipId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: tip } = await db
      .from("tips")
      .select("id, driver_id, amount_cents, company_id")
      .eq("id", data.tipId)
      .maybeSingle();
    if (!tip) throw new Error("Not found");
    const { data: driver } = await db
      .from("drivers")
      .select("user_id, company_id")
      .eq("id", tip.driver_id)
      .maybeSingle();
    if (!driver || !(await canAccessDriver(context.userId, driver))) throw new Error("Forbidden");
    await db
      .from("tips")
      .update({ verified: true, verified_at: new Date().toISOString() })
      .eq("id", tip.id);
    await db.from("cash_tip_verifications").insert({
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
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ tipId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: tip } = await db
      .from("tips")
      .select("id, driver_id, company_id")
      .eq("id", data.tipId)
      .maybeSingle();
    if (!tip) throw new Error("Not found");
    const { data: driver } = await db
      .from("drivers")
      .select("user_id, company_id")
      .eq("id", tip.driver_id)
      .maybeSingle();
    if (!driver || !(await canAccessDriver(context.userId, driver))) throw new Error("Forbidden");
    await db
      .from("tips")
      .update({ disputed: true, disputed_at: new Date().toISOString() })
      .eq("id", tip.id);
    await db.from("discrepancy_flags").insert({
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
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: roles } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", context.userId);
    const ok = roles?.some(
      (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === data.companyId),
    );
    if (!ok) throw new Error("Forbidden");

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tips } = await db
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