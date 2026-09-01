import { db } from "@/db/client.server";
import { sendSms } from "@/lib/sms/send.server";
const SITE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

async function sendNotice(args: {
  to: string;
  subject: string;
  companyName: string;
  heading: string;
  lines: string[];
  ctaUrl?: string;
  ctaLabel?: string;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const { enqueueTransactionalEmail } = await import("@/lib/email/invite.server");
    await enqueueTransactionalEmail({
      to: args.to,
      templateName: "notice",
      idempotencyKey: args.idempotencyKey,
      templateData: {
        subject: args.subject,
        companyName: args.companyName,
        heading: args.heading,
        preview: args.heading,
        lines: args.lines,
        ctaUrl: args.ctaUrl,
        ctaLabel: args.ctaLabel,
      },
    });
  } catch (e) {
    console.error("notice email failed", e);
  }
}

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
  return sendSms(to, body);
}

/** Notify the employee of a new tip or rating via SMS if opted in. */
export async function notifyEmployee(
  admin: typeof db,
  args: { companyId: string; driverId: string; kind: "tip" | "rating"; amountCents?: number | null; stars?: number | null; customerName?: string | null },
): Promise<void> {
  const { data: driver } = await admin
    .from("drivers")
    .select("id, display_name, phone, email, notify_sms, companies(name)")
    .eq("id", args.driverId)
    .maybeSingle();
  if (!driver) return;
  const cust = args.customerName?.trim() || "A customer";
  const companyName =
    (driver as { companies?: { name?: string } | null }).companies?.name ?? "Blue Collar Tips";
  let body: string;
  if (args.kind === "tip") {
    const amt = args.amountCents ? `$${(args.amountCents / 100).toFixed(2)}` : "a tip";
    body = `${cust} just left you ${amt}${args.stars ? ` and ${args.stars}★` : ""}. Nice work!`;
  } else {
    body = `${cust} just left you ${args.stars ?? "a"}★${args.stars && args.stars >= 5 ? " — great job!" : ""}`;
  }

  // Email notification
  if (driver.email) {
    await sendNotice({
      to: driver.email,
      subject: args.kind === "tip" ? "You just got a tip" : "You just got a new rating",
      companyName,
      heading:
        args.kind === "tip"
          ? `You just got ${args.amountCents ? `$${(args.amountCents / 100).toFixed(2)}` : "a tip"}`
          : `${cust} rated you ${args.stars ?? ""}★`.trim(),
      lines: [body, "Open your dashboard to see the full feedback and your running totals."],
      ctaUrl: `${SITE_URL}/dashboard/driver`,
      ctaLabel: "View my dashboard",
      idempotencyKey: `emp-${args.kind}-${args.driverId}-${Date.now()}`,
    });
  }

  if (!driver.notify_sms) return;
  const to = e164(driver.phone);
  if (!to) return;
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
  admin: typeof db,
  args: {
    companyId: string;
    driverId: string;
    customerPhone: string | null;
    customerEmail?: string | null;
    amountCents: number;
    last4?: string | null;
  },
): Promise<void> {
  const [{ data: company }, { data: driver }] = await Promise.all([
    admin.from("companies").select("name").eq("id", args.companyId).maybeSingle(),
    admin.from("drivers").select("display_name").eq("id", args.driverId).maybeSingle(),
  ]);
  const amt = `$${(args.amountCents / 100).toFixed(2)}`;
  const body =
    `Receipt from ${company?.name ?? "our team"}: ${amt} tip to ${driver?.display_name ?? "your service pro"} confirmed. ` +
    `Thanks for your generosity!`;

  if (args.customerEmail) {
    await sendNotice({
      to: args.customerEmail,
      subject: `Your ${amt} tip receipt`,
      companyName: company?.name ?? "Blue Collar Tips",
      heading: `Receipt: ${amt} tip`,
      lines: [
        `Your ${amt} tip to ${driver?.display_name ?? "your service pro"} was processed successfully on ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}.`,
        `Charged by ${company?.name ?? "our team"} via Blue Collar Tips. No further action is needed.`,
        "Thanks for recognizing great work.",
      ],
      idempotencyKey: `receipt-${args.driverId}-${args.amountCents}-${Date.now()}`,
    });
  }

  const to = e164(args.customerPhone);
  if (!to) return;
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
type TipPartyArgs = {
  companyId: string;
  driverId: string;
  amountCents: number;
  reason?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
};

async function tipParties(admin: typeof db, companyId: string, driverId: string) {
  const [{ data: company }, { data: driver }] = await Promise.all([
    admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    admin.from("drivers").select("display_name, email, phone, notify_sms").eq("id", driverId).maybeSingle(),
  ]);
  return {
    companyName: company?.name ?? "Blue Collar Tips",
    driver: driver as { display_name: string; email: string | null; phone: string | null; notify_sms: boolean } | null,
  };
}

/** Employee + admin-facing notice that a tip was flagged for review. */
export async function notifyTipDisputed(admin: typeof db, args: TipPartyArgs): Promise<void> {
  const { companyName, driver } = await tipParties(admin, args.companyId, args.driverId);
  if (!driver) return;
  const amt = `$${(args.amountCents / 100).toFixed(2)}`;
  const body = `A ${amt} tip on your account was flagged for review${args.reason ? `: ${args.reason}` : ""}. No action needed yet — your manager will follow up.`;

  if (driver.email) {
    await sendNotice({
      to: driver.email,
      subject: `A ${amt} tip was flagged for review`,
      companyName,
      heading: `${amt} tip flagged for review`,
      lines: [
        body,
        "Flagged tips are held out of verified totals until they are cleared or refunded.",
      ],
      ctaUrl: `${SITE_URL}/dashboard/driver`,
      ctaLabel: "View my dashboard",
      idempotencyKey: `tip-disputed-${args.driverId}-${args.amountCents}-${Date.now()}`,
    });
  }

  if (!driver.notify_sms) return;
  const to = e164(driver.phone);
  if (!to) return;
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

/** Notifies the employee and (when known) the customer that a tip was refunded. */
export async function notifyTipRefunded(admin: typeof db, args: TipPartyArgs): Promise<void> {
  const { companyName, driver } = await tipParties(admin, args.companyId, args.driverId);
  const amt = `$${(args.amountCents / 100).toFixed(2)}`;

  if (driver) {
    const body = `A ${amt} tip was refunded to the customer${args.reason ? ` (${args.reason})` : ""} and removed from your totals.`;
    if (driver.email) {
      await sendNotice({
        to: driver.email,
        subject: `A ${amt} tip was refunded`,
        companyName,
        heading: `${amt} tip refunded`,
        lines: [body, "Your dashboard totals have been updated to reflect the refund."],
        ctaUrl: `${SITE_URL}/dashboard/driver`,
        ctaLabel: "View my dashboard",
        idempotencyKey: `tip-refunded-emp-${args.driverId}-${args.amountCents}-${Date.now()}`,
      });
    }
    if (driver.notify_sms) {
      const to = e164(driver.phone);
      if (to) {
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
    }
  }

  const custBody = `${companyName}: your ${amt} tip has been refunded. It should appear on your statement within 5-10 business days.`;
  if (args.customerEmail) {
    await sendNotice({
      to: args.customerEmail,
      subject: `Your ${amt} tip was refunded`,
      companyName,
      heading: `Refund confirmed: ${amt}`,
      lines: [
        custBody,
        `Refund issued by ${companyName} on ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}.`,
        "If you have questions, reply to this email and the team will help.",
      ],
      idempotencyKey: `tip-refunded-cust-${args.driverId}-${args.amountCents}-${Date.now()}`,
    });
  }
  const to = e164(args.customerPhone);
  if (!to) return;
  const res = await twilioSend(to, custBody);
  await admin.from("sms_deliveries").insert({
    company_id: args.companyId,
    driver_id: args.driverId,
    to_phone: to,
    body: custBody,
    provider_sid: res.sid,
    status: res.status,
    error: res.error,
    sent_by: null,
  });
}
