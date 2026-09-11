import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

async function assertSuper(userId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const platformOverview = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertSuper(context.userId);
    const { db } = await import("@/db/client.server");
    const [{ data: tenants }, { data: tips }, { data: drivers }, { data: users }, { data: roles }] = await Promise.all([
      db
        .from("companies")
        .select("id, name, slug, status, created_at, primary_color")
        .order("created_at", { ascending: false }),
      db
        .from("tips")
        .select("id, driver_id, amount_cents, driver_amount_cents, company_amount_cents, platform_amount_cents, company_id, source, verified, created_at")
        .order("created_at", { ascending: false }),
      db.from("drivers").select("*", { count: "exact", head: true }),
      db.from("users").select("id, email, full_name, created_at").order("created_at", { ascending: false }),
      db.from("user_roles").select("user_id, role, company_id, companies(name)"),
    ]);

    const rolesByUser = new Map<string, Array<{ role: string; companyId: string | null; companyName: string }>>();
    for (const membership of roles ?? []) {
      const company = Array.isArray(membership.companies) ? membership.companies[0] : membership.companies;
      const list = rolesByUser.get(membership.user_id) ?? [];
      list.push({
        role: membership.role,
        companyId: membership.company_id,
        companyName: company?.name ?? (membership.role === "super_admin" ? "Platform" : "Unassigned"),
      });
      rolesByUser.set(membership.user_id, list);
    }

    const byCompany = new Map<string, { gross: number; companyShare: number; platformShare: number; count: number; pendingCompany: number }>();
    let platformTotal = 0;
    let grossTotal = 0;
    const byEmployee = new Map<string, { gross: number; net: number; platformShare: number; count: number }>();
    for (const t of tips ?? []) {
      const m = byCompany.get(t.company_id) ?? { gross: 0, companyShare: 0, platformShare: 0, count: 0, pendingCompany: 0 };
      m.gross += t.amount_cents;
      m.companyShare += t.company_amount_cents;
      m.platformShare += t.platform_amount_cents;
      m.count += 1;
      // Stage one: card tips are collected in the platform Stripe balance and
      // the company's ledger share remains pending until it is paid manually.
      if (t.source === "stripe") m.pendingCompany += t.company_amount_cents;
      byCompany.set(t.company_id, m);
      platformTotal += t.platform_amount_cents;
      grossTotal += t.amount_cents;
      if (t.driver_id) {
        const employee = byEmployee.get(t.driver_id) ?? { gross: 0, net: 0, platformShare: 0, count: 0 };
        employee.gross += t.amount_cents;
        employee.net += t.driver_amount_cents;
        employee.platformShare += t.platform_amount_cents;
        employee.count += 1;
        byEmployee.set(t.driver_id, employee);
      }
    }

    return {
      tenants: (tenants ?? []).map((c) => ({ ...c, ...(byCompany.get(c.id) ?? { gross: 0, companyShare: 0, platformShare: 0, count: 0, pendingCompany: 0 }) })),
      platformTotal,
      grossTotal,
      tips: tips ?? [],
      driverCount: drivers ?? 0,
      userCount: users?.length ?? 0,
      users: (users ?? []).map((user) => ({ ...user, memberships: rolesByUser.get(user.id) ?? [] })),
      employees: (await db.from("drivers").select("id, display_name, email, company_id, status, companies(name)")).data?.map((employee) => ({
        ...employee,
        ...(byEmployee.get(employee.id) ?? { gross: 0, net: 0, platformShare: 0, count: 0 }),
      })) ?? [],
      integrations: {
        stripe: !!process.env.STRIPE_SECRET_KEY,
        twilio: !!(process.env.TWILIO_API_KEY && process.env.TWILIO_FROM_NUMBER),
      },
    };
  });

export const suspendTenant = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ companyId: z.string().uuid(), status: z.enum(["active", "suspended"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { db } = await import("@/db/client.server");
    await db.from("companies").update({ status: data.status }).eq("id", data.companyId);
    return { ok: true };
  });
