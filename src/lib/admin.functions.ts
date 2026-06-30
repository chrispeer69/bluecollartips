import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { slugify } from "./constants";
import { randomBytes } from "crypto";

function generateInviteCode() {
  return randomBytes(6).toString("hex").toUpperCase();
}

async function assertCompanyAdmin(userId: string, companyId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", userId);
    const isSuper = roles?.some((r) => r.role === "super_admin") ?? false;
    let companyId = data.companyId ?? roles?.find((r) => r.role === "company_admin")?.company_id;
    if (!companyId) {
      // Super admin without a selection: default to first company
      const { data: first } = await supabaseAdmin.from("companies").select("id").limit(1).maybeSingle();
      companyId = first?.id ?? undefined;
    }
    if (!companyId) return { isSuper, company: null, drivers: [], ratings: [], tips: [], flags: [] };
    await assertCompanyAdmin(userId, companyId);

    const [{ data: company }, { data: drivers }, { data: ratings }, { data: tips }, { data: flags }, { data: companies }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
      supabase
        .from("drivers")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("ratings")
        .select("id, stars, feedback, customer_name, driver_id, created_at, flagged")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("tips")
        .select("id, amount_cents, source, customer_name, driver_id, company_amount_cents, platform_amount_cents, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("discrepancy_flags")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      isSuper ? supabaseAdmin.from("companies").select("id, name, slug") : Promise.resolve({ data: null }),
    ]);
    return { isSuper, company, drivers: drivers ?? [], ratings: ratings ?? [], tips: tips ?? [], flags: flags ?? [], companies: companies ?? null };
  });

export const createDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        companyId: z.string().uuid(),
        displayName: z.string().trim().min(1).max(80),
        email: z.string().trim().email().optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        employeeId: z.string().trim().max(60).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baseSlug = slugify(data.displayName);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: driver, error } = await supabaseAdmin
      .from("drivers")
      .insert({
        company_id: data.companyId,
        display_name: data.displayName,
        slug,
        email: data.email ?? null,
        phone: data.phone ?? null,
        employee_id: data.employeeId ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;

    const code = generateInviteCode();
    await supabaseAdmin.from("invites").insert({
      company_id: data.companyId,
      code,
      role: "driver",
      email: data.email ?? null,
      created_by: context.userId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return { ok: true, driverId: driver.id, inviteCode: code };
  });

export const setDriverStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        driverId: z.string().uuid(),
        status: z.enum(["pending", "active", "deactivated"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("company_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!driver) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, driver.company_id);
    const { error } = await supabaseAdmin
      .from("drivers")
      .update({ status: data.status })
      .eq("id", data.driverId);
    if (error) throw error;
    return { ok: true };
  });

export const updateCompanyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
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

export const resolveFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: flag } = await supabaseAdmin
      .from("discrepancy_flags")
      .select("company_id")
      .eq("id", data.flagId)
      .maybeSingle();
    if (!flag) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, flag.company_id);
    const { error } = await supabaseAdmin
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        adminEmail: z.string().trim().email().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "super_admin");
    if (!roles?.length) throw new Error("Forbidden");
    const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .insert({ name: data.name, slug })
      .select("id, slug")
      .single();
    if (error) throw error;
    const code = generateInviteCode();
    await supabaseAdmin.from("invites").insert({
      company_id: company.id,
      code,
      role: "company_admin",
      email: data.adminEmail,
      created_by: context.userId,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return { ok: true, companyId: company.id, slug: company.slug, inviteCode: code };
  });

export const getThankYouTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("companies")
      .select(
        "thank_you_enabled, thank_you_sms_template, thank_you_email_subject, thank_you_email_template",
      )
      .eq("id", data.companyId)
      .maybeSingle();
    return row;
  });

export const updateThankYouTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
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