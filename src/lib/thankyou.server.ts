import { db } from "@/db/client.server";
import { sendSms } from "./sms/send.server";

function e164(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return "+1" + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return "+" + cleaned;
  return null;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) =>
    vars[k.toLowerCase()] ?? "",
  );
}

export interface ThankYouContext {
  companyId: string;
  driverId: string;
  ratingId?: string | null;
  stars: number;
  tipCents?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}

export async function sendThankYou(
  admin: typeof db,
  ctx: ThankYouContext,
): Promise<{ smsStatus?: string; emailStatus?: string }> {
  if (!ctx.customerPhone && !ctx.customerEmail) return {};

  const { data: company } = await admin
    .from("companies")
    .select(
      "id, name, thank_you_enabled, thank_you_sms_template, thank_you_email_subject, thank_you_email_template",
    )
    .eq("id", ctx.companyId)
    .maybeSingle();
  if (!company || !company.thank_you_enabled) return {};

  const { data: driver } = await admin
    .from("drivers")
    .select("display_name")
    .eq("id", ctx.driverId)
    .maybeSingle();

  const tipAmount =
    ctx.tipCents && ctx.tipCents > 0
      ? "$" + (ctx.tipCents / 100).toFixed(2)
      : "";
  const vars: Record<string, string> = {
    customer_name: ctx.customerName?.trim() || "there",
    driver_name: driver?.display_name ?? "your service pro",
    employee_name: driver?.display_name ?? "your service pro",
    company_name: company.name,
    stars: String(ctx.stars),
    tip_amount: tipAmount || "no tip",
    tip_line: tipAmount ? ` and the ${tipAmount} tip` : "",
  };

  const out: { smsStatus?: string; emailStatus?: string } = {};

  // ---- SMS path ----
  if (ctx.customerPhone) {
    const to = e164(ctx.customerPhone);
    const body = renderTemplate(company.thank_you_sms_template, vars);
    let status = "queued";
    let error: string | null = null;
    let providerSid: string | null = null;

    if (!to) {
      status = "failed";
      error = "Invalid phone";
    } else {
      const result = await sendSms(to, body);
      status = result.status;
      error = result.error;
      providerSid = result.sid;
    }

    await admin.from("sms_deliveries").insert({
      company_id: ctx.companyId,
      driver_id: ctx.driverId,
      to_phone: to ?? ctx.customerPhone,
      body,
      provider_sid: providerSid,
      status,
      error,
      sent_by: null,
    });
    out.smsStatus = status;
  }

  // ---- Email path (log-only until an email provider is connected) ----
  if (ctx.customerEmail) {
    const subject = renderTemplate(company.thank_you_email_subject, vars);
    const body = renderTemplate(company.thank_you_email_template, vars);
    let status = "queued";
    let error: string | null = null;
    try {
      const { enqueueTransactionalEmail } = await import("@/lib/email/invite.server");
      const res = await enqueueTransactionalEmail({
        to: ctx.customerEmail,
        templateName: "notice",
        idempotencyKey: `thankyou-${ctx.ratingId ?? ctx.driverId}-${Date.now()}`,
        templateData: {
          subject,
          companyName: company.name,
          heading: subject,
          preview: subject,
          lines: body.split(/\n+/).map((l) => l.trim()).filter(Boolean),
        },
      });
      if (res && res.queued === false) {
        status = "skipped";
        error = res.reason ?? "suppressed";
      }
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : "Email send failed";
    }
    await admin.from("email_deliveries").insert({
      company_id: ctx.companyId,
      driver_id: ctx.driverId,
      rating_id: ctx.ratingId ?? null,
      to_email: ctx.customerEmail,
      subject,
      body,
      status,
      error,
    });
    out.emailStatus = status;
  }

  return out;
}
