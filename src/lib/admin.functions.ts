import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { slugify } from "./constants";
import { randomBytes } from "crypto";

const APP_BASE_URL =
  process.env.APP_BASE_URL ?? "https://bluecollartips.app";
const ADMIN_DRIVER_FIELDS = "id, company_id, user_id, location_id, display_name, slug, employee_id, email, phone, photo_url, status, venmo_handle, cashapp_handle, zelle_handle, paypal_handle, stripe_account_id, stripe_onboarded, stripe_charges_enabled, stripe_payouts_enabled, notify_sms, payout_method, payout_account_name, created_at";

function generateInviteCode() {
  return randomBytes(6).toString("hex").toUpperCase();
}

async function uniqueDriverSlug(db: any, companyId: string, displayName: string) {
  const base = slugify(displayName) || "employee";
  const { data: existing } = await db.from("drivers").select("id").eq("company_id", companyId).eq("slug", base).maybeSingle();
  return existing ? `${base}-${randomBytes(2).toString("hex")}` : base;
}

async function assertCompanyAdmin(userId: string, companyId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  const ok =
    data?.some(
      (r) =>
        r.role === "super_admin" ||
        (r.role === "company_admin" && r.company_id === companyId),
    ) ?? false;
  if (!ok) throw new Error("Forbidden");
}

export const getAdminDashboard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { db } = await import("@/db/client.server");
    const { data: roles } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", userId);
    const isSuper = roles?.some((r) => r.role === "super_admin") ?? false;
    const adminCompanyIds = roles?.filter((r) => r.role === "company_admin" && r.company_id).map((r) => r.company_id) ?? [];
    let companyId = data.companyId ?? roles?.find((r) => r.role === "company_admin")?.company_id;
    if (!companyId) {
      // Super admin without a selection: default to first company
      const { data: first } = await db.from("companies").select("id").limit(1).maybeSingle();
      companyId = first?.id ?? undefined;
    }
    if (!companyId) return { isSuper, company: null, drivers: [], ratings: [], tips: [], flags: [] };
    await assertCompanyAdmin(userId, companyId);

    const [{ data: company }, { data: drivers }, { data: ratings }, { data: tips }, { data: flags }, { data: companies }] = await Promise.all([
      db.from("companies").select("*").eq("id", companyId).maybeSingle(),
      db
        .from("drivers")
        .select(ADMIN_DRIVER_FIELDS)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      db
        .from("ratings")
        .select("id, stars, feedback, customer_name, driver_id, created_at, flagged")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("tips")
        .select("id, amount_cents, source, customer_name, driver_id, driver_amount_cents, company_amount_cents, platform_amount_cents, verified, disputed, refunded_at, stripe_payment_intent_id, stripe_status, assigned_by, assigned_at, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("discrepancy_flags")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      isSuper && adminCompanyIds.length ? db.from("companies").select("id, name, slug").in("id", adminCompanyIds) : Promise.resolve({ data: null }),
    ]);
    const safeCompany = company ? {
      ...company,
      has_review_webhook_secret: Boolean(company.review_webhook_secret_encrypted),
      review_webhook_secret_encrypted: undefined,
      payout_details_encrypted: undefined,
    } : null;
    return { isSuper, company: safeCompany, drivers: drivers ?? [], ratings: ratings ?? [], tips: tips ?? [], flags: flags ?? [], companies: companies ?? null };
  });

export const createDriver = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        companyId: z.string().uuid(),
        displayName: z.string().trim().min(1).max(80),
        email: z.string().trim().email(),
        phone: z.string().trim().max(40).optional().nullable(),
        employeeId: z.string().trim().max(60).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const slug = await uniqueDriverSlug(db, data.companyId, data.displayName);
    const { data: driver, error } = await db
      .from("drivers")
      .insert({
        company_id: data.companyId,
        display_name: data.displayName,
        slug,
        email: data.email,
        phone: data.phone ?? null,
        employee_id: data.employeeId ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;

    const code = generateInviteCode();
    await db.from("invites").insert({
      company_id: data.companyId,
      code,
      role: "driver",
      email: data.email,
      created_by: context.userId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    let emailed = false;
    if (data.email) {
      try {
        const { enqueueTransactionalEmail } = await import(
          "@/lib/email/invite.server"
        );
        const { data: company } = await db
          .from("companies")
          .select("name")
          .eq("id", data.companyId)
          .maybeSingle();
        await enqueueTransactionalEmail({
          to: data.email,
          templateData: {
            recipientName: data.displayName,
            companyName: company?.name ?? "your company",
            inviteUrl: `${APP_BASE_URL}/join/${code}`,
            inviteCode: code,
            role: "driver",
          },
          idempotencyKey: `driver-invite-${driver.id}-${code}`,
        });
        emailed = true;
      } catch (err) {
        console.error("Failed to send driver invite email", err);
      }
    }
    return { ok: true, driverId: driver.id, inviteCode: code, emailed };
  });

export const setDriverStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        driverId: z.string().uuid(),
        status: z.enum(["pending", "active", "deactivated"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: driver } = await db
      .from("drivers")
      .select("company_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!driver) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, driver.company_id);
    const { error } = await db
      .from("drivers")
      .update({ status: data.status })
      .eq("id", data.driverId);
    if (error) throw error;
    return { ok: true };
  });

export const assignCompanyTipToDriver = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    tipId: z.string().uuid(),
    driverId: z.string().uuid().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [tipCompany] = await database`SELECT company_id FROM tips WHERE id = ${data.tipId}`;
    if (!tipCompany) throw new Error("Tip not found");
    await assertCompanyAdmin(context.userId, tipCompany.company_id);

    return database.begin(async (tx) => {
      const [tip] = await tx`
        SELECT id, company_id, driver_id, verified, disputed, refunded_at
        FROM tips WHERE id = ${data.tipId} FOR UPDATE
      `;
      if (!tip) throw new Error("Tip not found");
      if (tip.driver_id) throw new Error("This tip is already assigned to an employee");
      if (!tip.verified || tip.disputed || tip.refunded_at) throw new Error("Only verified, undisputed tips can be assigned");
      const [driver] = data.driverId ? await tx`
        SELECT id, company_id, status FROM drivers WHERE id = ${data.driverId}
      ` : [null];
      if (data.driverId && (!driver || driver.company_id !== tip.company_id)) throw new Error("Employee does not belong to this company");
      if (driver && driver.status !== "active") throw new Error("Employee must be active");
      await tx`
        UPDATE tips SET driver_id = ${driver?.id ?? null}, assigned_by = ${context.userId}, assigned_at = NOW()
        WHERE id = ${tip.id}
      `;
      return { ok: true, assignedTo: driver ? "employee" : "company" };
    });
  });

export const updateCompanyBranding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        companyId: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        logoUrl: z.string().trim().url().max(500).optional().nullable(),
        primaryColor: z.string().trim().max(20).optional(),
        secondaryColor: z.string().trim().max(20).optional(),
        supportEmail: z.string().trim().email().max(200).optional().nullable(),
        supportPhone: z.string().trim().max(40).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { error } = await db
      .from("companies")
      .update({
        name: data.name,
        logo_url: data.logoUrl ?? undefined,
        primary_color: data.primaryColor,
        secondary_color: data.secondaryColor,
        support_email: data.supportEmail ?? undefined,
        support_phone: data.supportPhone ?? undefined,
      })
      .eq("id", data.companyId);
    if (error) throw error;
    return { ok: true };
  });

export const updateCompanyTipShare = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    companyPercent: z.number().int().min(0).max(10),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const platformPercent = 10;
    const driverPercent = 100 - platformPercent - data.companyPercent;
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("companies").update({
      company_pct: data.companyPercent,
      driver_pct: driverPercent,
      platform_pct: platformPercent,
    }).eq("id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true, companyPercent: data.companyPercent, driverPercent, platformPercent };
  });

export const resolveFlag = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        flagId: z.string().uuid(),
        status: z.enum(["resolved", "violation", "open"]),
        notes: z.string().trim().max(1000).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: flag } = await db
      .from("discrepancy_flags")
      .select("company_id")
      .eq("id", data.flagId)
      .maybeSingle();
    if (!flag) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, flag.company_id);
    const { error } = await db
      .from("discrepancy_flags")
      .update({
        status: data.status,
        notes: data.notes ?? undefined,
        resolved_at: data.status === "open" ? null : new Date().toISOString(),
      })
      .eq("id", data.flagId);
    if (error) throw error;
    return { ok: true };
  });

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        adminEmail: z.string().trim().email().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: roles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "super_admin");
    if (!roles?.length) throw new Error("Forbidden");
    const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: company, error } = await db
      .from("companies")
      .insert({ name: data.name, slug })
      .select("id, slug")
      .single();
    if (error) throw error;
    const code = generateInviteCode();
    await db.from("invites").insert({
      company_id: company.id,
      code,
      role: "company_admin",
      email: data.adminEmail,
      created_by: context.userId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    let emailed = false;
    try {
      const { enqueueTransactionalEmail } = await import(
        "@/lib/email/invite.server"
      );
      await enqueueTransactionalEmail({
        to: data.adminEmail,
        templateData: {
          companyName: data.name,
          inviteUrl: `${APP_BASE_URL}/join/${code}`,
          inviteCode: code,
          role: "company_admin",
        },
        idempotencyKey: `company-invite-${company.id}-${code}`,
      });
      emailed = true;
    } catch (err) {
      console.error("Failed to send company invite email", err);
    }
    return { ok: true, companyId: company.id, slug: company.slug, inviteCode: code, emailed };
  });

export const getThankYouTemplates = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { data: row } = await db
      .from("companies")
      .select(
        "thank_you_enabled, thank_you_sms_template, thank_you_email_subject, thank_you_email_template",
      )
      .eq("id", data.companyId)
      .maybeSingle();
    return row;
  });

export const updateThankYouTemplates = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        companyId: z.string().uuid(),
        enabled: z.boolean(),
        smsTemplate: z.string().trim().min(1).max(800),
        emailSubject: z.string().trim().min(1).max(200),
        emailTemplate: z.string().trim().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { error } = await db
      .from("companies")
      .update({
        thank_you_enabled: data.enabled,
        thank_you_sms_template: data.smsTemplate,
        thank_you_email_subject: data.emailSubject,
        thank_you_email_template: data.emailTemplate,
      })
      .eq("id", data.companyId);
    if (error) throw error;
    return { ok: true };
  });
