import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { randomBytes } from "crypto";
import { sendSms } from "./sms/send.server";

const APP_BASE_URL =
  process.env.APP_BASE_URL ?? "https://bluecollartips.app";

function normalizeE164(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return "+1" + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return "+" + cleaned;
  return null;
}

export const listInvites = createServerFn({ method: "POST" })
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
    const { data: items } = await db
      .from("invites")
      .select("id, code, role, email, expires_at, used_at, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(50);
    return { items: items ?? [] };
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        companyId: z.string().uuid(),
        role: z.enum(["company_admin", "driver"]),
        email: z.string().email().optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        recipientName: z.string().trim().max(120).optional().nullable(),
      })
      .parse(d),
  )
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
    const code = randomBytes(6).toString("hex").toUpperCase();
    const { data: inviteRow } = await db.from("invites").insert({
      company_id: data.companyId,
      code,
      role: data.role,
      email: data.email ?? null,
      created_by: context.userId,
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    }).select("id").single();

    const inviteUrl = `${APP_BASE_URL}/join/${code}`;
    let emailed = false;
    let texted = false;
    let deliveryError: string | null = null;

    const { data: company } = await db
      .from("companies")
      .select("name")
      .eq("id", data.companyId)
      .maybeSingle();
    const companyName = company?.name ?? "your company";

    if (data.email) {
      try {
        const { enqueueTransactionalEmail } = await import(
          "@/lib/email/invite.server"
        );
        await enqueueTransactionalEmail({
          to: data.email,
          templateData: {
            recipientName: data.recipientName ?? undefined,
            companyName,
            inviteUrl,
            inviteCode: code,
            role: data.role,
          },
          idempotencyKey: `invite-${inviteRow?.id ?? code}`,
        });
        emailed = true;
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : "Email send failed";
        console.error("createInvite email failed", err);
      }
    }

    if (data.phone) {
      try {
        const to = normalizeE164(data.phone);
        if (!to) throw new Error("Invalid phone number");
        const body =
          data.role === "driver"
            ? `${companyName} added you as a driver on Blue Collar Tips. Activate your account: ${inviteUrl}`
            : `You're invited to manage ${companyName} on Blue Collar Tips. Activate: ${inviteUrl}`;
        const result = await sendSms(to, body);
        const status = result.status;
        const providerSid = result.sid;
        const sendErr = result.error;
        texted = status === "sent";
        await db.from("sms_deliveries").insert({
          company_id: data.companyId,
          driver_id: null,
          to_phone: to,
          body,
          provider_sid: providerSid,
          status,
          error: sendErr,
          sent_by: context.userId,
        });
        if (sendErr && !texted) deliveryError = sendErr;
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : "SMS send failed";
        console.error("createInvite sms failed", err);
      }
    }

    return { code, inviteUrl, emailed, texted, error: deliveryError };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: inv } = await db
      .from("invites")
      .select("company_id, used_at")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!inv) throw new Error("Not found");
    if (inv.used_at) throw new Error("Already used");
    const { data: roles } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", context.userId);
    const ok = roles?.some(
      (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === inv.company_id),
    );
    if (!ok) throw new Error("Forbidden");
    await db
      .from("invites")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", data.inviteId);
    return { ok: true };
  });

/** Public: peek at an invite by code (for the join landing page). */
export const peekInvite = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: z.string().trim().min(1).max(64) }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await import("@/db/client.server");
    const { data: inv } = await db
      .from("invites")
      .select("role, email, expires_at, used_at, company_id, companies(name, slug, logo_url, primary_color)")
      .eq("code", data.code)
      .maybeSingle();
    if (!inv) return { valid: false as const };
    const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
    return {
      valid: !inv.used_at && !expired,
      used: !!inv.used_at,
      expired: !!expired,
      role: inv.role,
      email: inv.email,
      company: inv.companies,
    };
  });
