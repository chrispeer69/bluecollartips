import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

type AdminClient = Awaited<typeof import("@/db/client.server")>["db"];

async function requireCompanyAdmin(admin: AdminClient, userId: string, companyId: string) {
  const { data: roles } = await admin
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  const ok = roles?.some(
    (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === companyId),
  );
  if (!ok) throw new Error("Forbidden");
}

async function loadTip(admin: AdminClient, tipId: string) {
  const { data: tip } = await admin
    .from("tips")
    .select(
      "id, company_id, driver_id, rating_id, amount_cents, source, stripe_payment_intent_id, disputed, refunded_at, refund_amount_cents",
    )
    .eq("id", tipId)
    .maybeSingle();
  if (!tip) throw new Error("Tip not found");
  return tip;
}

async function customerContact(admin: AdminClient, ratingId: string | null) {
  if (!ratingId) return { customerEmail: null as string | null, customerPhone: null as string | null };
  const { data } = await admin
    .from("ratings")
    .select("customer_email, customer_phone, customer_contact")
    .eq("id", ratingId)
    .maybeSingle();
  return {
    customerEmail: data?.customer_email ?? null,
    customerPhone: data?.customer_phone ?? data?.customer_contact ?? null,
  };
}

/** Admin: list flagged / refunded tips for a company with their open flags. */
export const listTipDisputes = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    await requireCompanyAdmin(db, context.userId, data.companyId);
    const { data: rows } = await db
      .from("tips")
      .select(
        "id, driver_id, amount_cents, source, customer_name, created_at, disputed, disputed_at, dispute_reason, refunded_at, refund_amount_cents, refund_reason, verified, stripe_payment_intent_id",
      )
      .eq("company_id", data.companyId)
      .or("disputed.eq.true,refunded_at.not.is.null")
      .order("created_at", { ascending: false })
      .limit(100);
    return { items: rows ?? [] };
  });

/** Admin: flag a problematic tip. Opens a discrepancy flag and notifies the employee. */
export const flagTipDispute = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ tipId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const tip = await loadTip(db, data.tipId);
    await requireCompanyAdmin(db, context.userId, tip.company_id);

    await db
      .from("tips")
      .update({
        disputed: true,
        disputed_at: new Date().toISOString(),
        dispute_reason: data.reason,
        verified: false,
      })
      .eq("id", tip.id);

    await db.from("discrepancy_flags").insert({
      company_id: tip.company_id,
      driver_id: tip.driver_id,
      tip_id: tip.id,
      reason: "admin_dispute",
      status: "open",
      notes: data.reason,
      created_by: context.userId,
    });

    try {
      const { notifyTipDisputed } = await import("@/lib/notify.server");
      await notifyTipDisputed(db, {
        companyId: tip.company_id,
        driverId: tip.driver_id,
        amountCents: tip.amount_cents,
        reason: data.reason,
      });
    } catch (e) {
      console.error("dispute notify failed", e);
    }
    return { ok: true };
  });

/** Admin: clear a dispute without refunding. Resolves open flags on the tip. */
export const clearTipDispute = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({ tipId: z.string().uuid(), notes: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const tip = await loadTip(db, data.tipId);
    await requireCompanyAdmin(db, context.userId, tip.company_id);

    await db
      .from("tips")
      .update({
        disputed: false,
        disputed_at: null,
        dispute_reason: null,
        verified: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", tip.id);

    await db
      .from("discrepancy_flags")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        notes: data.notes ?? "Cleared by admin — tip verified",
      })
      .eq("tip_id", tip.id)
      .eq("status", "open");

    return { ok: true };
  });

/**
 * Admin: refund a tip. Card tips are refunded through Stripe (full or partial);
 * manual tips are reversed in-app. Notifies the employee and the customer.
 */
export const refundTip = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        tipId: z.string().uuid(),
        amountCents: z.number().int().positive().optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const tip = await loadTip(db, data.tipId);
    await requireCompanyAdmin(db, context.userId, tip.company_id);
    if (tip.refunded_at) throw new Error("This tip was already refunded");

    const amount = Math.min(data.amountCents ?? tip.amount_cents, tip.amount_cents);
    let refundId: string | null = null;

    if (tip.source === "stripe") {
      if (!tip.stripe_payment_intent_id) throw new Error("No card payment on file for this tip");
      const { getStripe } = await import("./stripe.server");
      const stripe = getStripe();
      if (!stripe) throw new Error("Card refunds are unavailable until Stripe is configured");
      const refund = await stripe.refunds.create({
        payment_intent: tip.stripe_payment_intent_id,
        amount,
        reason: "requested_by_customer",
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { tip_id: tip.id, refunded_by: context.userId },
      });
      refundId = refund.id;
    }

    await db
      .from("tips")
      .update({
        refunded_at: new Date().toISOString(),
        refund_amount_cents: amount,
        refund_reason: data.reason ?? null,
        stripe_refund_id: refundId,
        stripe_status: tip.source === "stripe" ? "refunded" : null,
        disputed: true,
        disputed_at: new Date().toISOString(),
        dispute_reason: tip.disputed ? undefined : (data.reason ?? "Refunded by admin"),
        verified: false,
      })
      .eq("id", tip.id);

    await db
      .from("discrepancy_flags")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        notes: `Refunded ${(amount / 100).toFixed(2)}${data.reason ? ` — ${data.reason}` : ""}`,
      })
      .eq("tip_id", tip.id)
      .eq("status", "open");

    try {
      const contact = await customerContact(db, tip.rating_id);
      const { notifyTipRefunded } = await import("@/lib/notify.server");
      await notifyTipRefunded(db, {
        companyId: tip.company_id,
        driverId: tip.driver_id,
        amountCents: amount,
        reason: data.reason ?? null,
        ...contact,
      });
    } catch (e) {
      console.error("refund notify failed", e);
    }

    return { ok: true, amountCents: amount, refundId };
  });
