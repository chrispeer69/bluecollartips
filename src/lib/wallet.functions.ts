import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

const OPEN_PAYOUT_STATUSES = ["pending", "approved", "processing"] as const;
const RESERVED_PAYOUT_STATUSES = [...OPEN_PAYOUT_STATUSES, "paid"] as const;

async function rolesFor(userId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db.from("user_roles").select("role, company_id").eq("user_id", userId);
  return data ?? [];
}

async function requireDriverAccess(userId: string, driverId: string, ownAccountOnly = false) {
  const { db } = await import("@/db/client.server");
  const { data: driver } = await db
    .from("drivers")
    .select("id, user_id, company_id, display_name, status")
    .eq("id", driverId)
    .maybeSingle();
  if (!driver) throw new Error("Employee not found");
  if (driver.user_id === userId) return driver;
  if (ownAccountOnly) throw new Error("Only the employee can request this payout");
  const roles = await rolesFor(userId);
  const allowed = roles.some(
    (role) => role.role === "super_admin" || (role.role === "company_admin" && role.company_id === driver.company_id),
  );
  if (!allowed) throw new Error("Forbidden");
  return driver;
}

async function requireSuperAdmin(userId: string) {
  const roles = await rolesFor(userId);
  const allowed = roles.some((role) => role.role === "super_admin");
  if (!allowed) throw new Error("Forbidden");
}

export const getDriverWallet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const driver = await requireDriverAccess(context.userId, data.driverId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [settings] = await database`
      SELECT payout_minimum_cents, payout_processing_days
      FROM platform_settings
      WHERE singleton = true
    `;
    if (!settings) throw new Error("Platform payout settings are unavailable");

    const [earnings] = await database`
      SELECT
        COALESCE(SUM(driver_amount_cents), 0)::int AS earned_cents
      FROM tips
      WHERE driver_id = ${driver.id}
        AND source = 'stripe'
        AND verified = true
        AND stripe_status = 'succeeded'
        AND disputed = false
        AND refunded_at IS NULL
    `;
    const [payouts] = await database`
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ${database(RESERVED_PAYOUT_STATUSES)}), 0)::int AS reserved_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid_cents
      FROM payout_requests
      WHERE driver_id = ${driver.id}
    `;
    const [openRequest] = await database`
      SELECT id, amount_cents, status, requested_at
      FROM payout_requests
      WHERE driver_id = ${driver.id}
        AND status IN ${database(OPEN_PAYOUT_STATUSES)}
      ORDER BY requested_at DESC
      LIMIT 1
    `;

    const earnedCents = Number(earnings?.earned_cents ?? 0);
    const reservedCents = Number(payouts?.reserved_cents ?? 0);
    return {
      driverId: driver.id,
      availableCents: Math.max(0, earnedCents - reservedCents),
      paidCents: Number(payouts?.paid_cents ?? 0),
      minimumCents: Number(settings.payout_minimum_cents),
      processingDays: Number(settings.payout_processing_days),
      canRequest: driver.user_id === context.userId && !openRequest,
      openRequest: openRequest ?? null,
    };
  });

export const requestWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireDriverAccess(context.userId, data.driverId, true);
    const { sql } = await import("@/db/client.server");
    const database = sql();

    return database.begin(async (tx) => {
      const [driver] = await tx`
        SELECT d.id, d.user_id, d.company_id, d.status
        FROM drivers d
        WHERE d.id = ${data.driverId}
        FOR UPDATE
      `;
      if (!driver || driver.user_id !== context.userId) throw new Error("Only the employee can request this payout");
      if (driver.status !== "active") throw new Error("Employee account is not active");

      const [settings] = await tx`
        SELECT payout_minimum_cents, payout_processing_days
        FROM platform_settings
        WHERE singleton = true
      `;
      if (!settings) throw new Error("Platform payout settings are unavailable");

      const [openRequest] = await tx`
        SELECT id FROM payout_requests
        WHERE driver_id = ${driver.id}
          AND status IN ${tx(OPEN_PAYOUT_STATUSES)}
        LIMIT 1
      `;
      if (openRequest) throw new Error("A payout request is already open");

      const [earnings] = await tx`
        SELECT COALESCE(SUM(driver_amount_cents), 0)::int AS earned_cents
        FROM tips
        WHERE driver_id = ${driver.id}
          AND source = 'stripe'
          AND verified = true
          AND stripe_status = 'succeeded'
          AND disputed = false
          AND refunded_at IS NULL
      `;
      const [reserved] = await tx`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS amount_cents
        FROM payout_requests
        WHERE driver_id = ${driver.id}
          AND status IN ${tx(RESERVED_PAYOUT_STATUSES)}
      `;
      const available = Math.max(0, Number(earnings.earned_cents) - Number(reserved.amount_cents));
      if (available < Number(settings.payout_minimum_cents)) {
        throw new Error(`A minimum balance of $${(Number(settings.payout_minimum_cents) / 100).toFixed(2)} is required`);
      }

      const [request] = await tx`
        INSERT INTO payout_requests (
          company_id, driver_id, amount_cents, requested_by
        ) VALUES (
          ${driver.company_id}, ${driver.id}, ${available}, ${context.userId}
        )
        RETURNING id, amount_cents, status, requested_at
      `;
      return { ok: true, request };
    });
  });

export const getPlatformWallet = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [settings] = await database`
      SELECT payout_minimum_cents, payout_processing_days
      FROM platform_settings WHERE singleton = true
    `;
    const requests = await database`
      SELECT pr.id, pr.driver_id, d.display_name AS driver_name,
             c.name AS company_name,
             pr.amount_cents, pr.status, pr.payment_method,
             pr.payment_reference, pr.admin_note, pr.requested_at,
             pr.reviewed_at, pr.paid_at
      FROM payout_requests pr
      JOIN drivers d ON d.id = pr.driver_id
      JOIN companies c ON c.id = pr.company_id
      ORDER BY pr.requested_at DESC
      LIMIT 200
    `;
    return {
      minimumCents: Number(settings?.payout_minimum_cents ?? 2500),
      processingDays: Number(settings?.payout_processing_days ?? 5),
      requests,
    };
  });

export const updatePlatformWalletSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    minimumCents: z.number().int().min(100).max(100000),
    processingDays: z.number().int().min(0).max(5),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("platform_settings").update({
      payout_minimum_cents: data.minimumCents,
      payout_processing_days: data.processingDays,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    }).eq("singleton", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Super-admin recovery path for a successful PaymentIntent whose webhook
 * failed before the tip ledger was updated. Stripe remains the authority: the
 * server retrieves the intent and only records it when Stripe says succeeded.
 */
export const recoverStripeTip = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    paymentIntentId: z.string().trim().regex(/^pi_[A-Za-z0-9_]+$/).max(255),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe is not configured");
    const intent = await stripe.paymentIntents.retrieve(data.paymentIntentId);
    if (intent.status !== "succeeded") throw new Error(`Stripe payment is ${intent.status}, not succeeded`);
    const { db } = await import("@/db/client.server");
    const { recordSuccessfulStripeTip } = await import("./stripe-tip-ledger.server");
    const result = await recordSuccessfulStripeTip(db, {
      id: intent.id,
      amount: intent.amount,
      metadata: intent.metadata,
      status: intent.status,
    });
    return { ok: true, alreadyRecorded: !result.recorded, amountCents: intent.amount };
  });

export const reviewPlatformWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    requestId: z.string().uuid(),
    action: z.enum(["approve", "reject", "mark_paid"]),
    paymentMethod: z.string().trim().max(100).optional().nullable(),
    paymentReference: z.string().trim().max(200).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  }).superRefine((value, ctx) => {
    if (value.action === "mark_paid" && !value.paymentMethod) {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Payment method is required" });
    }
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.userId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    return database.begin(async (tx) => {
      const [request] = await tx`
        SELECT id, company_id, status FROM payout_requests
        WHERE id = ${data.requestId}
        FOR UPDATE
      `;
      if (!request) throw new Error("Payout request not found");

      if (data.action === "approve") {
        if (request.status !== "pending") throw new Error("Only pending requests can be approved");
        await tx`UPDATE payout_requests SET status = 'approved', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      } else if (data.action === "reject") {
        if (!["pending", "approved"].includes(request.status)) throw new Error("This request can no longer be rejected");
        await tx`UPDATE payout_requests SET status = 'rejected', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      } else {
        if (!["pending", "approved", "processing"].includes(request.status)) throw new Error("This request cannot be marked paid");
        await tx`UPDATE payout_requests SET status = 'paid', reviewed_by = ${context.userId}, reviewed_at = COALESCE(reviewed_at, NOW()), paid_at = NOW(), payment_method = ${data.paymentMethod ?? null}, payment_reference = ${data.paymentReference ?? null}, admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      }
      return { ok: true };
    });
  });
