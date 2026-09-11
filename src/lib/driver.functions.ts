import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";

const DRIVER_DASHBOARD_FIELDS = "id, company_id, user_id, location_id, display_name, slug, employee_id, email, phone, photo_url, status, stripe_account_id, stripe_onboarded, stripe_charges_enabled, stripe_payouts_enabled, notify_sms, payout_method, payout_account_name, created_at, companies(name, slug, primary_color, secondary_color, logo_url)";

async function getUserRoles(userId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  return data ?? [];
}

async function resolveAccessibleDriver(userId: string, requestedDriverId?: string) {
  const { db } = await import("@/db/client.server");
  const roles = await getUserRoles(userId);
  const isSuper = roles.some((r) => r.role === "super_admin");
  const adminCompanyIds = roles
    .filter((r) => r.role === "company_admin" && r.company_id)
    .map((r) => r.company_id as string);

  const canAccess = (driver: { user_id: string | null; company_id: string }) =>
    driver.user_id === userId || isSuper || adminCompanyIds.includes(driver.company_id);

  const accessibleDrivers = await listAccessibleDrivers(userId, isSuper, adminCompanyIds);

  if (requestedDriverId) {
    const { data: driver } = await db
      .from("drivers")
      .select(DRIVER_DASHBOARD_FIELDS)
      .eq("id", requestedDriverId)
      .maybeSingle();
    if (!driver || !canAccess(driver)) return { driver: null, roles, accessibleDrivers };
    return { driver, roles, accessibleDrivers };
  }

  const firstOwn = accessibleDrivers.find((driver) => driver.user_id === userId);
  if (firstOwn) {
    const { data: ownDriver } = await db
      .from("drivers")
      .select(DRIVER_DASHBOARD_FIELDS)
      .eq("id", firstOwn.id)
      .maybeSingle();
    return { driver: ownDriver, roles, accessibleDrivers };
  }

  if (isSuper || adminCompanyIds.length) {
    let query = db
      .from("drivers")
      .select(DRIVER_DASHBOARD_FIELDS)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!isSuper) query = query.in("company_id", adminCompanyIds);
    const { data: firstDriver } = await query.maybeSingle();
    return { driver: firstDriver ?? null, roles, accessibleDrivers };
  }

  return { driver: null, roles, accessibleDrivers: [] };
}

async function listAccessibleDrivers(userId: string, isSuper: boolean, adminCompanyIds: string[]) {
  const { db } = await import("@/db/client.server");
  const { data: own } = await db
    .from("drivers")
    .select("id, user_id, display_name, status, company_id, companies(name, slug)")
    .eq("user_id", userId)
    .order("display_name", { ascending: true });

  let managed: any[] = [];
  if (isSuper || adminCompanyIds.length) {
    let query = db
      .from("drivers")
      .select("id, user_id, display_name, status, company_id, companies(name, slug)")
      .order("display_name", { ascending: true });
    if (!isSuper) query = query.in("company_id", adminCompanyIds);
    const result = await query;
    managed = result.data ?? [];
  }

  const unique = new Map<string, any>();
  for (const driver of [...(own ?? []), ...managed]) unique.set(driver.id, driver);
  return [...unique.values()].sort((a, b) => {
    const companyA = a.companies?.name ?? "";
    const companyB = b.companies?.name ?? "";
    return companyA.localeCompare(companyB) || a.display_name.localeCompare(b.display_name);
  });
}

export const getDriverDashboard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { db } = await import("@/db/client.server");
    const { data: account } = await db.from("users").select("email").eq("id", userId).maybeSingle();
    if (account?.email) {
      const { acceptPendingEmailInvites } = await import("@/auth/email-invites.server");
      await acceptPendingEmailInvites(userId, account.email);
    }
    const { driver, roles, accessibleDrivers } = await resolveAccessibleDriver(userId, data?.driverId);
    if (!driver) return { driver: null, ratings: [], tips: [], flags: [], accessibleDrivers, viewingAsAdmin: false, accountEmail: account?.email ?? null };
    const [{ data: ratings }, { data: tips }, { data: flags }] = await Promise.all([
      db
        .from("ratings")
        .select("id, stars, feedback, customer_name, created_at, flagged")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("tips")
        .select(
          "id, amount_cents, source, customer_name, driver_amount_cents, company_amount_cents, platform_amount_cents, created_at, note",
        )
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("discrepancy_flags")
        .select("id, reason, status, notes, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false }),
    ]);
    const viewingAsAdmin = driver.user_id !== userId && roles.some((r) => r.role === "super_admin" || r.role === "company_admin");
    return { driver, ratings: ratings ?? [], tips: tips ?? [], flags: flags ?? [], accessibleDrivers, viewingAsAdmin, accountEmail: account?.email ?? null };
  });

export const updateDriverProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    driverId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(40).optional().nullable(),
    photoUrl: z.union([z.string().trim().url().max(1000), z.literal("")]).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { driver } = await resolveAccessibleDriver(context.userId, data.driverId);
    if (!driver) throw new Error("Employee profile not found or access denied");
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("drivers").update({
      display_name: data.displayName,
      phone: data.phone || null,
      photo_url: data.photoUrl || null,
    }).eq("id", driver.id);
    if (error) throw new Error(error.message);
    if (driver.user_id === context.userId) {
      await db.from("users").update({ full_name: data.displayName, phone: data.phone || null }).eq("id", context.userId);
    }
    return { ok: true, slug: driver.slug };
  });

export const logManualTip = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
    const { db } = await import("@/db/client.server");
    const { data: tip, error } = await db.from("tips").insert({
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
    }).select("driver_amount_cents, company_amount_cents, platform_amount_cents").single();
    if (error) throw error;
    return {
      ok: true,
      driverAmountCents: Number(tip.driver_amount_cents),
      companyAmountCents: Number(tip.company_amount_cents),
      platformAmountCents: Number(tip.platform_amount_cents),
    };
  });

export const updateNotifyPrefs = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      driverId: z.string().uuid().optional(),
      notifySms: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { driver } = await resolveAccessibleDriver(context.userId, data.driverId);
    if (!driver) throw new Error("No driver profile");
    const { db } = await import("@/db/client.server");
    const { error } = await db
      .from("drivers")
      .update({ notify_sms: data.notifySms })
      .eq("id", driver.id);
    if (error) throw error;
    return { ok: true };
  });
