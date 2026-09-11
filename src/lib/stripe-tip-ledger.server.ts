type PaymentIntentForTip = {
  id: string;
  amount: number;
  metadata?: Record<string, string> | null;
  status: string;
};

/**
 * Idempotently records a successful Stripe PaymentIntent in the internal tip
 * ledger. This is called by both the Stripe webhook and the browser-confirmed
 * fallback, so a delayed or retried webhook cannot create a duplicate tip.
 */
export async function recordSuccessfulStripeTip(
  db: (typeof import("@/db/client.server"))["db"],
  pi: PaymentIntentForTip,
) {
  if (pi.status !== "succeeded") throw new Error("Stripe payment is not complete");
  const companyId = pi.metadata?.company_id;
  const driverId = pi.metadata?.driver_id || null;
  if (!companyId) throw new Error("Stripe payment is missing company attribution");

  const values = {
    company_id: companyId,
    driver_id: driverId,
    amount_cents: pi.amount,
    source: "stripe",
    stripe_payment_intent_id: pi.id,
    stripe_status: pi.status,
    verified: true,
    verified_at: new Date().toISOString(),
    customer_name: pi.metadata?.customer_name || null,
    driver_amount_cents: 0,
    company_amount_cents: 0,
    platform_amount_cents: 0,
  };

  // INSERT ... ON CONFLICT DO NOTHING makes the browser confirmation and
  // Stripe webhook race-safe. Exactly one caller owns notifications.
  const { data: inserted, error } = await db
    .from("tips")
    .upsert(values, { onConflict: "stripe_payment_intent_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message ?? "Could not record tip");
  const recorded = Boolean(inserted?.length);

  // Repair a pre-existing incomplete ledger row without treating a retry as a
  // new tip. The database trigger recomputes the split if amount/company move.
  if (!recorded) {
    const { error: updateError } = await db
      .from("tips")
      .update({ ...values })
      .eq("stripe_payment_intent_id", pi.id);
    if (updateError) throw new Error(updateError.message ?? "Could not update tip");
  }

  return { recorded, companyId, driverId };
}
