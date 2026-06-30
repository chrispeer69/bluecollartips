import type { SupabaseClient } from "@supabase/supabase-js";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

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
  admin: SupabaseClient,
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
    driver_name: driver?.display_name ?? "your driver",
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

    const lovableKey = process.env.LOVABLE_API_KEY;
    const twilioKey = process.env.TWILIO_API_KEY;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!to) {
      status = "failed";
      error = "Invalid phone";
    } else if (!lovableKey || !twilioKey || !fromNumber) {
      status = "skipped";
      error = "Twilio not connected — logged only";
    } else {
      try {
        const resp = await fetch(`${TWILIO_GATEWAY}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": twilioKey,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
        });
        const json = (await resp.json()) as { sid?: string; message?: string };
        if (!resp.ok) {
          status = "failed";
          error = json.message ?? `Twilio ${resp.status}`;
        } else {
          providerSid = json.sid ?? null;
          status = "sent";
        }
      } catch (e) {
        status = "failed";
        error = e instanceof Error ? e.message : "Send failed";
      }
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
    let status = "skipped";
    const error = "Email provider not connected — logged only";
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