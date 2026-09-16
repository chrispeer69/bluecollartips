import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "./constants";

async function resolveStripeDriver(userId: string, driverId?: string) {
  const { db } = await import("@/db/client.server");
  let query = db
    .from("drivers")
    .select("id, email, display_name, stripe_account_id, company_id, user_id")
    .limit(1);
  query = driverId ? query.eq("id", driverId) : query.eq("user_id", userId);
  const { data: driver } = await query.maybeSingle();
  if (!driver) throw new Error("No driver profile");
  if (driver.user_id === userId) return driver;

  const { data: roles } = await db
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  const ok = roles?.some(
    (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === driver.company_id),
  );
  if (!ok) throw new Error("Forbidden");
  return driver;
}

/** Driver-initiated Stripe Express onboarding. Returns a one-time AccountLink URL. */
export const createDriverOnboardingLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ returnUrl: z.string().url(), driverId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe is not configured yet. Ask the platform admin to add STRIPE_SECRET_KEY.");
    const { db } = await import("@/db/client.server");
    const driver = await resolveStripeDriver(context.userId, data.driverId);

    let accountId = driver.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: driver.email ?? undefined,
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        metadata: { driver_id: driver.id },
      });
      accountId = account.id;
      await db.from("drivers").update({ stripe_account_id: accountId }).eq("id", driver.id);
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: data.returnUrl,
      return_url: data.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url };
  });

/** Refresh Stripe status flags for the signed-in driver. */
export const refreshStripeStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ driverId: z.string().uuid().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) return { enabled: false };
    const { db } = await import("@/db/client.server");
    const driver = await resolveStripeDriver(context.userId, data?.driverId);
    if (!driver?.stripe_account_id) return { enabled: false };
    const acct = await stripe.accounts.retrieve(driver.stripe_account_id);
    await db
      .from("drivers")
      .update({
        stripe_charges_enabled: !!acct.charges_enabled,
        stripe_payouts_enabled: !!acct.payouts_enabled,
      })
      .eq("id", driver.id);
    return { enabled: true, charges: !!acct.charges_enabled, payouts: !!acct.payouts_enabled };
  });

/** Public: collects a tip into the platform Stripe account.
 *
 * Driver/company attribution is retained in metadata and the tips ledger. Payouts
 * are handled separately, so a driver does not need a connected Stripe account
 * before a customer can leave a card tip.
 */
export const createTipPaymentIntent = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        companySlug: z.string().min(1),
        driverSlug: z.string().min(1).optional().nullable(),
        amountCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
        customerName: z.string().trim().max(120).optional().nullable(),
        customerPhone: z.string().trim().max(40).optional().nullable(),
        customerEmail: z.string().trim().max(200).optional().nullable(),
        stars: z.number().int().min(1).max(5).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Online payments are not configured yet.");
    if (data.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.customerEmail)) {
      throw new Error("Please enter a valid email address.");
    }
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select("id")
      .eq("slug", data.companySlug)
      .eq("status", "active")
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    const { data: driver } = data.driverSlug
      ? await db
          .from("drivers")
          .select("id, status, display_name")
          .eq("company_id", company.id)
          .eq("slug", data.driverSlug)
          .maybeSingle()
      : { data: null };
    if (data.driverSlug && (!driver || driver.status !== "active")) {
      throw new Error("Driver not available");
    }

    const pi = await stripe.paymentIntents.create({
      amount: data.amountCents,
      currency: "usd",
      // Automatically shows every method enabled in the Stripe Dashboard that
      // is eligible for this currency, amount, and buyer region.
      automatic_payment_methods: { enabled: true, allow_redirects: "always" },
      metadata: {
        company_id: company.id,
        driver_id: driver?.id ?? "",
        customer_name: data.customerName ?? "",
        customer_phone: data.customerPhone ?? "",
        customer_email: data.customerEmail ?? "",
        stars: String(data.stars ?? ""),
      },
    });
    return { clientSecret: pi.client_secret, paymentIntentId: pi.id };
  });

export const getStripePublishableKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null };
});

/**
 * Browser-confirmed fallback for the Stripe webhook. The PaymentIntent is
 * retrieved from Stripe and its client secret is checked before any ledger
 * write, so the browser cannot invent or alter a successful tip.
 */
export const finalizeTipPayment = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      paymentIntentId: z.string().trim().regex(/^pi_[A-Za-z0-9_]+$/).max(255),
      clientSecret: z.string().trim().min(20).max(500),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe is not configured yet.");
    const pi = await stripe.paymentIntents.retrieve(data.paymentIntentId);
    if (!pi.client_secret || pi.client_secret !== data.clientSecret) {
      throw new Error("Payment verification failed");
    }
    if (pi.status !== "succeeded") throw new Error("Payment has not completed yet");

    const { db } = await import("@/db/client.server");
    const { recordSuccessfulStripeTip } = await import("./stripe-tip-ledger.server");
    await recordSuccessfulStripeTip(db, {
      id: pi.id,
      amount: pi.amount,
      created: pi.created,
      metadata: pi.metadata,
      status: pi.status,
    });
    return { ok: true };
  });
