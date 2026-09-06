import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

/**
 * Payout statement: returns every tip for a driver in a date range,
 * with the 80/10/10 split, day-level subtotals, and grand totals.
 * Access: driver themself, super_admin, or company_admin of the driver's company.
 */
export const getPayoutStatement = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      driverId: z.string().uuid(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: driver } = await db
      .from("drivers")
      .select("id, display_name, user_id, company_id, companies(name, slug)")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!driver) throw new Error("Not found");
    // Authorization
    if (driver.user_id !== context.userId) {
      const { data: roles } = await db
        .from("user_roles")
        .select("role, company_id")
        .eq("user_id", context.userId);
      const isSuper = roles?.some((r) => r.role === "super_admin");
      const isAdmin = roles?.some((r) => r.role === "company_admin" && r.company_id === driver.company_id);
      if (!isSuper && !isAdmin) throw new Error("Forbidden");
    }

    let q = db
      .from("tips")
      .select("id, amount_cents, driver_amount_cents, company_amount_cents, platform_amount_cents, source, verified, customer_name, note, created_at")
      .eq("driver_id", data.driverId)
      .order("created_at", { ascending: false });
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    const { data: tips, error } = await q;
    if (error) throw error;

    const rows = tips ?? [];
    const totals = rows.reduce(
      (acc, t) => {
        acc.gross += t.amount_cents;
        acc.driver += t.driver_amount_cents;
        acc.company += t.company_amount_cents;
        acc.platform += t.platform_amount_cents;
        return acc;
      },
      { gross: 0, driver: 0, company: 0, platform: 0 },
    );
    return {
      driver: { id: driver.id, name: driver.display_name, company: driver.companies?.name ?? "" },
      tips: rows,
      totals,
      range: { from: data.from ?? null, to: data.to ?? null },
    };
  });