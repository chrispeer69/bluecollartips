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

/** Public: creates a PaymentIntent with 20% application fee, transferring 80% to driver. */
export const createTipPaymentIntent = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        companySlug: z.string().min(1),
        driverSlug: z.string().min(1),
        amountCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
        customerName: z.string().trim().max(120).optional().nullable(),
        customerPhone: z.string().trim().max(40).optional().nullable(),
        customerEmail: z.string().trim().email().max(200).optional().nullable(),
        stars: z.number().int().min(1).max(5).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getStripe } = await import("./stripe.server");
    const stripe = getStripe();
    if (!stripe) throw new Error("Card payments are not configured yet.");
    const { db } = await import("@/db/client.server");
    const { data: company } = await db
      .from("companies")
      .select("id")
      .eq("slug", data.companySlug)
      .maybeSingle();
    if (!company) throw new Error("Company not found");
    const { data: driver } = await db
      .from("drivers")
      .select("id, stripe_account_id, stripe_charges_enabled, status, display_name")
      .eq("company_id", company.id)
      .eq("slug", data.driverSlug)
      .maybeSingle();
    if (!driver || driver.status !== "active") throw new Error("Driver not available");
    if (!driver.stripe_account_id || !driver.stripe_charges_enabled)
      throw new Error("This driver isn't accepting card tips yet.");

    const applicationFee = Math.round((data.amountCents * 20) / 100);
    const pi = await stripe.paymentIntents.create({
      amount: data.amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      application_fee_amount: applicationFee,
      transfer_data: { destination: driver.stripe_account_id },
      metadata: {
        company_id: company.id,
        driver_id: driver.id,
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