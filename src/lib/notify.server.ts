import type { SupabaseClient } from "@supabase/supabase-js";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio";

function e164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return "+1" + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return "+" + cleaned;
  return null;
}

async function twilioSend(to: string, body: string): Promise<{ status: string; sid: string | null; error: string | null }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!lovableKey || !twilioKey || !fromNumber) {
    return { status: "skipped", sid: null, error: "Twilio not connected" };
  }
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
    if (!resp.ok) return { status: "failed", sid: null, error: json.message ?? `Twilio ${resp.status}` };
    return { status: "sent", sid: json.sid ?? null, error: null };
  } catch (e) {
    return { status: "failed", sid: null, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** Notify the employee of a new tip or rating via SMS if opted in. */
export async function notifyEmployee(
  admin: SupabaseClient,
  args: { companyId: string; driverId: string; kind: "tip" | "rating"; amountCents?: number | null; stars?: number | null; customerName?: string | null },
): Promise<void> {
  const { data: driver } = await admin
    .from("drivers")
    .select("id, display_name, phone, notify_sms, companies(name)")
    .eq("id", args.driverId)
    .maybeSingle();
  if (!driver || !driver.notify_sms) return;
  const to = e164(driver.phone);
  if (!to) return;
  const cust = args.customerName?.trim() || "A customer";
  let body: string;
  if (args.kind === "tip") {
    const amt = args.amountCents ? `$${(args.amountCents / 100).toFixed(2)}` : "a tip";
    body = `${cust} just left you ${amt}${args.stars ? ` and ${args.stars}★` : ""}. Nice work!`;
  } else {
    body = `${cust} just left you ${args.stars ?? "a"}★${args.stars && args.stars >= 5 ? " — great job!" : ""}`;
  }
  const res = await twilioSend(to, body);
  await admin.from("sms_deliveries").insert({
    company_id: args.companyId,
    driver_id: args.driverId,
    to_phone: to,
    body,
    provider_sid: res.sid,
    status: res.status,
    error: res.error,
    sent_by: null,
  });
}

/** Send a card-tip receipt via SMS to the customer's phone (if provided). */
export async function sendCustomerReceipt(
  admin: SupabaseClient,
  args: {
    companyId: string;
    driverId: string;
    customerPhone: string | null;
    amountCents: number;
    last4?: string | null;
  },
): Promise<void> {
  const to = e164(args.customerPhone);
  if (!to) return;
  const [{ data: company }, { data: driver }] = await Promise.all([
    admin.from("companies").select("name").eq("id", args.companyId).maybeSingle(),
    admin.from("drivers").select("display_name").eq("id", args.driverId).maybeSingle(),
  ]);
  const amt = `$${(args.amountCents / 100).toFixed(2)}`;
  const body =
    `Receipt from ${company?.name ?? "our team"}: ${amt} tip to ${driver?.display_name ?? "your service pro"} confirmed. ` +
    `Thanks for your generosity!`;
  const res = await twilioSend(to, body);
  await admin.from("sms_deliveries").insert({
    company_id: args.companyId,
    driver_id: args.driverId,
    to_phone: to,
    body,
    provider_sid: res.sid,
    status: res.status,
    error: res.error,
    sent_by: null,
  });
}