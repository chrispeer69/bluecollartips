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

/** Company-owner view of employee earnings, wallet balances and reconciliation. */
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

    const { sql } = await import("@/db/client.server");
    const database = sql();
    const result = await database`
      WITH tip_totals AS (
        SELECT
          driver_id,
          COUNT(*) FILTER (
            WHERE verified = true AND disputed = false AND refunded_at IS NULL
          )::integer AS total,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE verified = true AND disputed = false AND refunded_at IS NULL
          ), 0)::integer AS gross_cents,
          COALESCE(SUM(driver_amount_cents) FILTER (
            WHERE verified = true AND disputed = false AND refunded_at IS NULL
          ), 0)::integer AS employee_net_cents,
          COALESCE(SUM(driver_amount_cents) FILTER (
            WHERE source = 'stripe' AND verified = true AND stripe_status = 'succeeded'
              AND disputed = false AND refunded_at IS NULL
          ), 0)::integer AS stripe_earned_cents,
          COUNT(*) FILTER (
            WHERE source <> 'stripe' AND created_at >= NOW() - INTERVAL '30 days'
          )::integer AS manual,
          COUNT(*) FILTER (
            WHERE source <> 'stripe' AND verified = false
              AND disputed = false AND created_at >= NOW() - INTERVAL '30 days'
          )::integer AS unverified,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE source <> 'stripe' AND verified = false
              AND disputed = false AND created_at >= NOW() - INTERVAL '30 days'
          ), 0)::integer AS amount_unverified,
          MAX(created_at) AS last_tip_at
        FROM tips
        WHERE company_id = ${data.companyId} AND driver_id IS NOT NULL
        GROUP BY driver_id
      ), payout_totals AS (
        SELECT
          driver_id,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE status IN ('pending', 'approved', 'processing')
          ), 0)::integer AS pending_payout_cents,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE status = 'paid'
          ), 0)::integer AS paid_out_cents,
          COALESCE(SUM(amount_cents) FILTER (
            WHERE status IN ('pending', 'approved', 'processing', 'paid')
          ), 0)::integer AS reserved_cents
        FROM payout_requests
        WHERE company_id = ${data.companyId}
        GROUP BY driver_id
      )
      SELECT
        d.id AS driver_id,
        d.display_name,
        d.status,
        COALESCE(tt.total, 0)::integer AS total,
        COALESCE(tt.gross_cents, 0)::integer AS gross_cents,
        COALESCE(tt.employee_net_cents, 0)::integer AS employee_net_cents,
        GREATEST(COALESCE(tt.stripe_earned_cents, 0) - COALESCE(pt.reserved_cents, 0), 0)::integer AS available_cents,
        COALESCE(pt.pending_payout_cents, 0)::integer AS pending_payout_cents,
        COALESCE(pt.paid_out_cents, 0)::integer AS paid_out_cents,
        COALESCE(tt.manual, 0)::integer AS manual,
        COALESCE(tt.unverified, 0)::integer AS unverified,
        COALESCE(tt.amount_unverified, 0)::integer AS amount_unverified,
        tt.last_tip_at
      FROM drivers d
      LEFT JOIN tip_totals tt ON tt.driver_id = d.id
      LEFT JOIN payout_totals pt ON pt.driver_id = d.id
      WHERE d.company_id = ${data.companyId}
      ORDER BY d.status = 'active' DESC, d.display_name ASC
    `;
    const rows = result.map((row: any) => ({
      driverId: row.driver_id,
      displayName: row.display_name,
      status: row.status,
      total: Number(row.total),
      grossCents: Number(row.gross_cents),
      employeeNetCents: Number(row.employee_net_cents),
      availableCents: Number(row.available_cents),
      pendingPayoutCents: Number(row.pending_payout_cents),
      paidOutCents: Number(row.paid_out_cents),
      manual: Number(row.manual),
      unverified: Number(row.unverified),
      amountUnverified: Number(row.amount_unverified),
      unverifiedPct: Number(row.manual) ? Math.round((Number(row.unverified) / Number(row.manual)) * 100) : 0,
      lastTipAt: row.last_tip_at ? String(row.last_tip_at) : null,
    }));
    return { rows };
  });
