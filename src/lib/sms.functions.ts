import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { sendSms } from "./sms/send.server";


function e164(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return "+1" + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return "+" + cleaned;
  return null;
}

export const sendTipLinkSms = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        driverId: z.string().uuid(),
        toPhone: z.string().trim().min(7).max(40),
        customerName: z.string().trim().max(120).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const to = e164(data.toPhone);
    if (!to) throw new Error("Invalid phone number. Use a US number or include country code.");
    const { db } = await import("@/db/client.server");

    const { data: driver } = await db
      .from("drivers")
      .select("id, company_id, slug, display_name, user_id, companies(slug, name)")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!driver) throw new Error("Driver not found");

    // Authorization: driver self, or company admin / super admin
    if (driver.user_id !== context.userId) {
      const { data: roles } = await db
        .from("user_roles")
        .select("role, company_id")
        .eq("user_id", context.userId);
      const ok = roles?.some(
        (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === driver.company_id),
      );
      if (!ok) throw new Error("Forbidden");
    }

    const origin = process.env.APP_PUBLIC_URL ?? "https://app.bluecollar.ai";
    const url = `${origin}/${driver.companies?.slug}/d/${driver.slug}`;
    const greeting = data.customerName ? `Hi ${data.customerName}, ` : "";
    const body = `${greeting}thanks for choosing ${driver.companies?.name ?? "us"}. Rate ${driver.display_name} or leave a tip: ${url}`;

    const result = await sendSms(to, body);
    const providerSid = result.sid;
    const status = result.status;
    const error = result.error;

    await db.from("sms_deliveries").insert({
      company_id: driver.company_id,
      driver_id: driver.id,
      to_phone: to,
      body,
      provider_sid: providerSid,
      status,
      error,
      sent_by: context.userId,
    });

    return { status, error, sid: providerSid, url };
  });

export const listDriverSms = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: driver } = await db
      .from("drivers")
      .select("company_id, user_id")
      .eq("id", data.driverId)
      .maybeSingle();
    if (!driver) return { items: [] };
    if (driver.user_id !== context.userId) {
      const { data: roles } = await db
        .from("user_roles")
        .select("role, company_id")
        .eq("user_id", context.userId);
      const ok = roles?.some(
        (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === driver.company_id),
      );
      if (!ok) return { items: [] };
    }
    const { data: items } = await db
      .from("sms_deliveries")
      .select("id, to_phone, status, error, created_at, body")
      .eq("driver_id", data.driverId)
      .order("created_at", { ascending: false })
      .limit(25);
    return { items: items ?? [] };
  });
