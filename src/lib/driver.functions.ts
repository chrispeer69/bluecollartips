import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";

async function getUserRoles(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  return data ?? [];
}

async function resolveAccessibleDriver(userId: string, requestedDriverId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const roles = await getUserRoles(userId);
  const isSuper = roles.some((r) => r.role === "super_admin");
  const adminCompanyIds = roles
    .filter((r) => r.role === "company_admin" && r.company_id)
    .map((r) => r.company_id as string);

  const canAccess = (driver: { user_id: string | null; company_id: string }) =>
    driver.user_id === userId || isSuper || adminCompanyIds.includes(driver.company_id);

  if (requestedDriverId) {
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("*, companies(name, slug, primary_color, secondary_color, logo_url)")
      .eq("id", requestedDriverId)
      .maybeSingle();
    if (!driver || !canAccess(driver)) return { driver: null, roles, accessibleDrivers: [] };
    return { driver, roles, accessibleDrivers: await listAccessibleDrivers(userId, isSuper, adminCompanyIds) };
  }

  const { data: ownDriver } = await supabaseAdmin
    .from("drivers")
    .select("*, companies(name, slug, primary_color, secondary_color, logo_url)")
    .eq("user_id", userId)
    .maybeSingle();
  if (ownDriver) {
    return { driver: ownDriver, roles, accessibleDrivers: await listAccessibleDrivers(userId, isSuper, adminCompanyIds) };
  }

  if (isSuper || adminCompanyIds.length) {
    let query = supabaseAdmin
      .from("drivers")
      .select("*, companies(name, slug, primary_color, secondary_color, logo_url)")
      .order("created_at", { ascending: false })
      .limit(1);
    if (!isSuper) query = query.in("company_id", adminCompanyIds);
    const { data: firstDriver } = await query.maybeSingle();
    return { driver: firstDriver ?? null, roles, accessibleDrivers: await listAccessibleDrivers(userId, isSuper, adminCompanyIds) };
  }

  return { driver: null, roles, accessibleDrivers: [] };
}

async function listAccessibleDrivers(userId: string, isSuper: boolean, adminCompanyIds: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!isSuper && !adminCompanyIds.length) return [];
  let query = supabaseAdmin
    .from("drivers")
    .select("id, display_name, status, company_id, companies(name, slug)")
    .order("display_name", { ascending: true });
  if (!isSuper) query = query.in("company_id", adminCompanyIds);
  const { data } = await query;
  return data ?? [];
}

export const getDriverDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { driver, roles, accessibleDrivers } = await resolveAccessibleDriver(userId, data?.driverId);
    if (!driver) return { driver: null, ratings: [], tips: [], flags: [], accessibleDrivers, viewingAsAdmin: false };
    const [{ data: ratings }, { data: tips }, { data: flags }] = await Promise.all([
      supabaseAdmin
        .from("ratings")
        .select("id, stars, feedback, customer_name, created_at, flagged")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("tips")
        .select(
          "id, amount_cents, source, customer_name, driver_amount_cents, company_amount_cents, platform_amount_cents, created_at, note",
        )
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("discrepancy_flags")
        .select("id, reason, status, notes, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false }),
    ]);
    const viewingAsAdmin = driver.user_id !== userId && roles.some((r) => r.role === "super_admin" || r.role === "company_admin");
    return { driver, ratings: ratings ?? [], tips: tips ?? [], flags: flags ?? [], accessibleDrivers, viewingAsAdmin };
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
        driverId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { driver } = await resolveAccessibleDriver(userId, data.driverId);
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