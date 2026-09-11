import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

const OPEN_PAYOUT_STATUSES = ["pending", "approved", "processing"] as const;
const RESERVED_PAYOUT_STATUSES = [...OPEN_PAYOUT_STATUSES, "paid"] as const;
const payoutMethodSchema = z.enum(["bank_transfer", "cash_app", "venmo", "zelle", "paypal", "check", "other"]);
const usBankDetailsSchema = z.object({
  type: z.literal("us_bank"),
  bankName: z.string().trim().min(1).max(120),
  accountType: z.enum(["checking", "savings"]),
  routingNumber: z.string().regex(/^\d{9}$/),
  accountNumber: z.string().regex(/^\d{4,17}$/),
});
const payoutDestinationSchema = z.object({
  method: payoutMethodSchema,
  accountName: z.string().trim().min(1).max(120),
  details: z.string().trim().min(3).max(1000),
}).superRefine((value, ctx) => {
  if (value.method !== "bank_transfer") return;
  try {
    const bank = usBankDetailsSchema.parse(JSON.parse(value.details));
    const digits = bank.routingNumber.split("").map(Number);
    const checksum = digits.reduce((sum, digit, index) => sum + digit * [3, 7, 1][index % 3], 0);
    if (checksum % 10 !== 0) ctx.addIssue({ code: "custom", path: ["details"], message: "Enter a valid U.S. routing number" });
  } catch {
    ctx.addIssue({ code: "custom", path: ["details"], message: "Complete the U.S. bank account details" });
  }
});

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

async function requireCompanyAdminAccess(userId: string, companyId: string) {
  const roles = await rolesFor(userId);
  const allowed = roles.some(
    (role) => role.role === "super_admin" || (role.role === "company_admin" && role.company_id === companyId),
  );
  if (!allowed) throw new Error("Forbidden");
}

export const saveDriverPayoutDestination = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => payoutDestinationSchema.extend({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const driver = await requireDriverAccess(context.userId, data.driverId);
    const { encryptPayoutDetails } = await import("./payout-destination.server");
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("drivers").update({
      payout_method: data.method,
      payout_account_name: data.accountName,
      payout_details_encrypted: encryptPayoutDetails(data.details),
    }).eq("id", driver.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveCompanyPayoutDestination = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => payoutDestinationSchema.extend({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCompanyAdminAccess(context.userId, data.companyId);
    const { encryptPayoutDetails } = await import("./payout-destination.server");
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("companies").update({
      payout_method: data.method,
      payout_account_name: data.accountName,
      payout_details_encrypted: encryptPayoutDetails(data.details),
    }).eq("id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDriverWallet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const driver = await requireDriverAccess(context.userId, data.driverId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [destination] = await database`
      SELECT payout_method, payout_account_name, payout_details_encrypted
      FROM drivers WHERE id = ${driver.id}
    `;
    const { decryptPayoutDetails } = await import("./payout-destination.server");
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
      canRequest: driver.user_id === context.userId && !openRequest && Boolean(destination?.payout_method && destination?.payout_details_encrypted),
      openRequest: openRequest ?? null,
      payoutDestination: destination?.payout_method && destination?.payout_details_encrypted ? {
        method: destination.payout_method,
        accountName: destination.payout_account_name ?? "",
        details: decryptPayoutDetails(destination.payout_details_encrypted) ?? "",
      } : null,
    };
  });

export const requestWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    driverId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireDriverAccess(context.userId, data.driverId, true);
    const { sql } = await import("@/db/client.server");
    const database = sql();

    return database.begin(async (tx) => {
      const [driver] = await tx`
        SELECT d.id, d.user_id, d.company_id, d.status, d.payout_method,
               d.payout_account_name, d.payout_details_encrypted
        FROM drivers d
        WHERE d.id = ${data.driverId}
        FOR UPDATE
      `;
      if (!driver || driver.user_id !== context.userId) throw new Error("Only the employee can request this payout");
      if (driver.status !== "active") throw new Error("Employee account is not active");
      if (!driver.payout_method || !driver.payout_account_name || !driver.payout_details_encrypted) {
        throw new Error("Add your payout details before requesting a payout");
      }

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
      const minimum = Number(settings.payout_minimum_cents);
      if (data.amountCents < minimum) {
        throw new Error(`The minimum withdrawal is $${(minimum / 100).toFixed(2)}`);
      }
      if (data.amountCents > available) {
        throw new Error("Withdrawal amount exceeds the available balance");
      }

      const [request] = await tx`
        INSERT INTO payout_requests (
          company_id, driver_id, amount_cents, requested_by,
          requested_payout_method, requested_payout_account_name, requested_payout_details_encrypted
        ) VALUES (
          ${driver.company_id}, ${driver.id}, ${data.amountCents}, ${context.userId},
          ${driver.payout_method}, ${driver.payout_account_name}, ${driver.payout_details_encrypted}
        )
        RETURNING id, amount_cents, status, requested_at
      `;
      return { ok: true, request };
    });
  });

export const getCompanyWallet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCompanyAdminAccess(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [destination] = await database`
      SELECT payout_method, payout_account_name, payout_details_encrypted
      FROM companies WHERE id = ${data.companyId}
    `;
    const { decryptPayoutDetails } = await import("./payout-destination.server");
    const [settings] = await database`
      SELECT payout_minimum_cents, payout_processing_days
      FROM platform_settings WHERE singleton = true
    `;
    if (!settings) throw new Error("Platform payout settings are unavailable");

    const [earnings] = await database`
      SELECT COALESCE(SUM(company_amount_cents), 0)::int AS earned_cents
      FROM tips
      WHERE company_id = ${data.companyId}
        AND source = 'stripe'
        AND verified = true
        AND stripe_status = 'succeeded'
        AND disputed = false
        AND refunded_at IS NULL
        AND (driver_id IS NOT NULL OR assigned_at IS NOT NULL)
    `;
    const [payouts] = await database`
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ${database(RESERVED_PAYOUT_STATUSES)}), 0)::int AS reserved_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid_cents
      FROM company_payout_requests
      WHERE company_id = ${data.companyId}
    `;
    const requests = await database`
      SELECT id, amount_cents, status, payment_method, payment_reference,
             admin_note, requested_at, reviewed_at, paid_at
      FROM company_payout_requests
      WHERE company_id = ${data.companyId}
      ORDER BY requested_at DESC
      LIMIT 25
    `;
    const openRequest = requests.find((request: any) => OPEN_PAYOUT_STATUSES.includes(request.status));
    const earnedCents = Number(earnings?.earned_cents ?? 0);
    const reservedCents = Number(payouts?.reserved_cents ?? 0);
    return {
      companyId: data.companyId,
      earnedCents,
      availableCents: Math.max(0, earnedCents - reservedCents),
      paidCents: Number(payouts?.paid_cents ?? 0),
      minimumCents: Number(settings.payout_minimum_cents),
      processingDays: Number(settings.payout_processing_days),
      canRequest: !openRequest && Boolean(destination?.payout_method && destination?.payout_details_encrypted),
      openRequest: openRequest ?? null,
      requests,
      payoutDestination: destination?.payout_method && destination?.payout_details_encrypted ? {
        method: destination.payout_method,
        accountName: destination.payout_account_name ?? "",
        details: decryptPayoutDetails(destination.payout_details_encrypted) ?? "",
      } : null,
    };
  });

export const requestCompanyWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    companyId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCompanyAdminAccess(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    return database.begin(async (tx) => {
      const [company] = await tx`
        SELECT id, status, payout_method, payout_account_name, payout_details_encrypted
        FROM companies WHERE id = ${data.companyId} FOR UPDATE
      `;
      if (!company) throw new Error("Company not found");
      if (company.status !== "active") throw new Error("Company account is not active");
      if (!company.payout_method || !company.payout_account_name || !company.payout_details_encrypted) {
        throw new Error("Add company payout details before requesting a payout");
      }

      const [settings] = await tx`
        SELECT payout_minimum_cents, payout_processing_days
        FROM platform_settings WHERE singleton = true
      `;
      if (!settings) throw new Error("Platform payout settings are unavailable");
      const [openRequest] = await tx`
        SELECT id FROM company_payout_requests
        WHERE company_id = ${company.id}
          AND status IN ${tx(OPEN_PAYOUT_STATUSES)}
        LIMIT 1
      `;
      if (openRequest) throw new Error("A company payout request is already open");

      const [earnings] = await tx`
        SELECT COALESCE(SUM(company_amount_cents), 0)::int AS earned_cents
        FROM tips
        WHERE company_id = ${company.id}
          AND source = 'stripe'
          AND verified = true
          AND stripe_status = 'succeeded'
          AND disputed = false
          AND refunded_at IS NULL
          AND (driver_id IS NOT NULL OR assigned_at IS NOT NULL)
      `;
      const [reserved] = await tx`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS amount_cents
        FROM company_payout_requests
        WHERE company_id = ${company.id}
          AND status IN ${tx(RESERVED_PAYOUT_STATUSES)}
      `;
      const available = Math.max(0, Number(earnings.earned_cents) - Number(reserved.amount_cents));
      const minimum = Number(settings.payout_minimum_cents);
      if (data.amountCents < minimum) {
        throw new Error(`The minimum withdrawal is $${(minimum / 100).toFixed(2)}`);
      }
      if (data.amountCents > available) {
        throw new Error("Withdrawal amount exceeds the available balance");
      }
      const [request] = await tx`
        INSERT INTO company_payout_requests (
          company_id, amount_cents, requested_by,
          requested_payout_method, requested_payout_account_name, requested_payout_details_encrypted
        ) VALUES (
          ${company.id}, ${data.amountCents}, ${context.userId},
          ${company.payout_method}, ${company.payout_account_name}, ${company.payout_details_encrypted}
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
      SELECT pr.id, 'employee'::text AS request_type, pr.company_id, pr.driver_id,
             d.display_name AS recipient_name, c.name AS company_name,
             pr.amount_cents, pr.status, pr.payment_method,
             pr.payment_reference, pr.admin_note, pr.requested_at,
             pr.reviewed_at, pr.paid_at,
             COALESCE(pr.requested_payout_method, d.payout_method) AS payout_destination_method,
             COALESCE(pr.requested_payout_account_name, d.payout_account_name) AS payout_destination_account_name,
             COALESCE(pr.requested_payout_details_encrypted, d.payout_details_encrypted) AS payout_destination_encrypted
      FROM payout_requests pr
      JOIN drivers d ON d.id = pr.driver_id
      JOIN companies c ON c.id = pr.company_id
      UNION ALL
      SELECT cpr.id, 'company'::text AS request_type, cpr.company_id, NULL::uuid AS driver_id,
             c.name AS recipient_name, c.name AS company_name,
             cpr.amount_cents, cpr.status, cpr.payment_method,
             cpr.payment_reference, cpr.admin_note, cpr.requested_at,
             cpr.reviewed_at, cpr.paid_at,
             COALESCE(cpr.requested_payout_method, c.payout_method) AS payout_destination_method,
             COALESCE(cpr.requested_payout_account_name, c.payout_account_name) AS payout_destination_account_name,
             COALESCE(cpr.requested_payout_details_encrypted, c.payout_details_encrypted) AS payout_destination_encrypted
      FROM company_payout_requests cpr
      JOIN companies c ON c.id = cpr.company_id
      ORDER BY requested_at DESC
      LIMIT 200
    `;
    const { decryptPayoutDetails } = await import("./payout-destination.server");
    const safeRequests = requests.map((request: any) => {
      const { payout_destination_encrypted, ...safe } = request;
      return {
        ...safe,
        payout_destination_details: payout_destination_encrypted
          ? decryptPayoutDetails(payout_destination_encrypted)
          : null,
      };
    });
    return {
      minimumCents: Number(settings?.payout_minimum_cents ?? 2500),
      processingDays: Number(settings?.payout_processing_days ?? 5),
      requests: safeRequests,
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
      created: intent.created,
      metadata: intent.metadata,
      status: intent.status,
    });
    return { ok: true, alreadyRecorded: !result.recorded, amountCents: intent.amount };
  });

/** Imports successful Blue Collar Tips PaymentIntents from Stripe in bounded
 * batches. Unrelated Stripe payments without company attribution are skipped.
 */
export const syncStripeTipHistory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.userId);
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe is not configured");
    const { db } = await import("@/db/client.server");
    const { recordSuccessfulStripeTip } = await import("./stripe-tip-ledger.server");

    let scanned = 0;
    let recorded = 0;
    let alreadyRecorded = 0;
    let skipped = 0;
    let failed = 0;
    let startingAfter: string | undefined;
    do {
      const page = await stripe.paymentIntents.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      for (const intent of page.data) {
        scanned += 1;
        if (intent.status !== "succeeded" || !intent.metadata?.company_id) {
          skipped += 1;
          continue;
        }
        try {
          const result = await recordSuccessfulStripeTip(db, {
            id: intent.id,
            amount: intent.amount,
            created: intent.created,
            metadata: intent.metadata,
            status: intent.status,
          });
          if (result.recorded) recorded += 1;
          else alreadyRecorded += 1;
        } catch (error) {
          failed += 1;
          console.error(`Stripe history sync failed for ${intent.id}`, error);
        }
      }
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter && scanned < 1000);

    return { ok: true, scanned, recorded, alreadyRecorded, skipped, failed, capped: scanned >= 1000 };
  });

export const reviewPlatformWalletPayout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    requestId: z.string().uuid(),
    requestType: z.enum(["employee", "company"]),
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
      const table = data.requestType === "company" ? "company_payout_requests" : "payout_requests";
      const [request] = data.requestType === "company"
        ? await tx`SELECT id, company_id, status FROM company_payout_requests WHERE id = ${data.requestId} FOR UPDATE`
        : await tx`SELECT id, company_id, status FROM payout_requests WHERE id = ${data.requestId} FOR UPDATE`;
      if (!request) throw new Error("Payout request not found");

      if (data.action === "approve") {
        if (request.status !== "pending") throw new Error("Only pending requests can be approved");
        if (table === "company_payout_requests") await tx`UPDATE company_payout_requests SET status = 'approved', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
        else await tx`UPDATE payout_requests SET status = 'approved', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      } else if (data.action === "reject") {
        if (!["pending", "approved"].includes(request.status)) throw new Error("This request can no longer be rejected");
        if (table === "company_payout_requests") await tx`UPDATE company_payout_requests SET status = 'rejected', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
        else await tx`UPDATE payout_requests SET status = 'rejected', reviewed_by = ${context.userId}, reviewed_at = NOW(), admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      } else {
        if (!["pending", "approved", "processing"].includes(request.status)) throw new Error("This request cannot be marked paid");
        if (table === "company_payout_requests") await tx`UPDATE company_payout_requests SET status = 'paid', reviewed_by = ${context.userId}, reviewed_at = COALESCE(reviewed_at, NOW()), paid_at = NOW(), payment_method = ${data.paymentMethod ?? null}, payment_reference = ${data.paymentReference ?? null}, admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
        else await tx`UPDATE payout_requests SET status = 'paid', reviewed_by = ${context.userId}, reviewed_at = COALESCE(reviewed_at, NOW()), paid_at = NOW(), payment_method = ${data.paymentMethod ?? null}, payment_reference = ${data.paymentReference ?? null}, admin_note = ${data.note ?? null}, updated_at = NOW() WHERE id = ${request.id}`;
      }
      return { ok: true };
    });
  });
