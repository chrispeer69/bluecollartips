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
        .select("id, driver_id, amount_cents, driver_amount_cents, company_amount_cents, platform_amount_cents, company_id, source, verified, stripe_payment_intent_id, stripe_status, customer_name, customer_contact, created_at")
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

/** Counts a super admin sees before deleting a tenant. */
export const tenantFootprint = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { sql } = await import("@/db/client.server");
    const [row] = await sql()`
      SELECT c.name, c.slug,
        (SELECT COUNT(*) FROM drivers WHERE company_id = c.id)::int AS drivers,
        (SELECT COUNT(*) FROM ratings WHERE company_id = c.id)::int AS ratings,
        (SELECT COUNT(*) FROM tips WHERE company_id = c.id)::int AS tips,
        (SELECT COUNT(*) FROM user_roles WHERE company_id = c.id)::int AS members,
        (SELECT COUNT(*) FROM support_tickets WHERE company_id = c.id)::int AS tickets
      FROM companies c WHERE c.id = ${data.companyId}`;
    if (!row) throw new Error("Company not found");
    return row as { name: string; slug: string; drivers: number; ratings: number; tips: number; members: number; tickets: number };
  });

/** Permanently delete a tenant and everything under it. Requires the exact
 *  company name typed back; refuses tenants with tips unless force is set. */
export const deleteTenant = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ companyId: z.string().uuid(), confirmName: z.string().trim().min(1), force: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [company] = await database`SELECT id, name FROM companies WHERE id = ${data.companyId}`;
    if (!company) throw new Error("Company not found");
    if (company.name.trim().toLowerCase() !== data.confirmName.trim().toLowerCase()) {
      throw new Error("Type the company name exactly to confirm deletion");
    }
    const [{ tips }] = await database`SELECT COUNT(*)::int AS tips FROM tips WHERE company_id = ${company.id}`;
    if (Number(tips) > 0 && !data.force) {
      throw new Error("This company has tips on record. Tick 'delete financial history too' to proceed.");
    }
    await database`DELETE FROM companies WHERE id = ${company.id}`;
    return { ok: true };
  });

/** Change a tenant's URL slug (company page, QR codes and tip links). */
export const updateTenantSlug = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), slug: z.string().trim().min(2).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { slugify } = await import("./constants");
    const slug = slugify(data.slug);
    if (!slug) throw new Error("Enter a valid URL name (letters, numbers, dashes)");
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [taken] = await database`SELECT id FROM companies WHERE slug = ${slug} AND id <> ${data.companyId}`;
    if (taken) throw new Error(`"${slug}" is already used by another company`);
    await database`UPDATE companies SET slug = ${slug} WHERE id = ${data.companyId}`;
    return { ok: true, slug };
  });

/** Issue (or re-surface) a company-admin invite, or attach an existing user directly. */
export const issueTenantAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), email: z.string().trim().email().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuper(context.userId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const email = data.email.toLowerCase();
    const base = (process.env.APP_BASE_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
    const [user] = await database`SELECT id FROM users WHERE lower(email) = ${email}`;
    if (user) {
      await database`INSERT INTO user_roles (user_id, company_id, role) VALUES (${user.id}, ${data.companyId}, 'company_admin') ON CONFLICT DO NOTHING`;
      return { ok: true, attached: true as const, inviteUrl: null, code: null };
    }
    const [existing] = await database`
      SELECT code FROM invites
      WHERE company_id = ${data.companyId} AND role = 'company_admin' AND lower(email) = ${email}
        AND used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`;
    let code: string = existing?.code;
    if (!code) {
      const { randomBytes } = await import("crypto");
      code = randomBytes(6).toString("hex").toUpperCase();
      await database`
        INSERT INTO invites (company_id, code, role, email, created_by, expires_at)
        VALUES (${data.companyId}, ${code}, 'company_admin', ${email}, ${context.userId}, NOW() + INTERVAL '30 days')`;
    }
    return { ok: true, attached: false as const, inviteUrl: `${base}/join/${code}`, code };
  });
