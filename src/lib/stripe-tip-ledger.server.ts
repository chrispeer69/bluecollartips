type PaymentIntentForTip = {
  id: string;
  amount: number;
  currency?: string;
  created?: number;
  metadata?: Record<string, string> | null;
  status: string;
};

export type RecordedStripeTip = {
  recorded: boolean;
  companyId: string;
  driverId: string | null;
  ratingId: string | null;
  tipId: string | null;
  tippedAt: string | null;
};

/**
 * Idempotently records a successful Stripe PaymentIntent in the internal tip
 * ledger. This is called by both the Stripe webhook and the browser-confirmed
 * fallback, so a delayed or retried webhook cannot create a duplicate tip.
 */
export async function recordSuccessfulStripeTip(
  db: (typeof import("@/db/client.server"))["db"],
  pi: PaymentIntentForTip,
): Promise<RecordedStripeTip> {
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
    customer_contact: pi.metadata?.customer_email || pi.metadata?.customer_phone || null,
    rating_id: pi.metadata?.rating_id || null,
    driver_amount_cents: 0,
    company_amount_cents: 0,
    platform_amount_cents: 0,
    ...(pi.created ? { created_at: new Date(pi.created * 1000).toISOString() } : {}),
  };

  // INSERT ... ON CONFLICT DO NOTHING makes the browser confirmation and
  // Stripe webhook race-safe. Exactly one caller owns notifications.
  const { data: inserted, error } = await db
    .from("tips")
    .upsert(values, { onConflict: "stripe_payment_intent_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message ?? "Could not record tip");
  const recorded = Boolean(inserted?.length);

  // Repair only an incomplete row. A completed row may have been assigned to a
  // driver later by the company, and webhook retries must never undo that.
  if (!recorded) {
    const { data: existing, error: readError } = await db
      .from("tips")
      .select("stripe_status")
      .eq("stripe_payment_intent_id", pi.id);
    if (readError) throw new Error(readError.message ?? "Could not inspect tip");
    if (existing?.[0]?.stripe_status !== "succeeded") {
      const { error: updateError } = await db
        .from("tips")
        .update({ ...values })
        .eq("stripe_payment_intent_id", pi.id);
      if (updateError) throw new Error(updateError.message ?? "Could not update tip");
    }
  }

  return {
    recorded,
    companyId,
    driverId,
    ratingId: pi.metadata?.rating_id || null,
    tipId: inserted?.[0]?.id ?? null,
    tippedAt: inserted?.[0]?.created_at ?? null,
  };
}

/**
 * Sends the successful tip back to the company's CRM webhook. Call this only
 * for the caller that inserted the ledger row; webhook retries and the browser
 * fallback then cannot produce duplicate GHL events.
 */
export async function deliverRecordedTipWebhook(
  db: (typeof import("@/db/client.server"))["db"],
  pi: PaymentIntentForTip,
  result: RecordedStripeTip,
) {
  if (!result.recorded || !result.ratingId) return;

  const [{ data: company }, { data: rating }, { data: reviewContext }, { data: driver }] = await Promise.all([
    db.from("companies")
      .select("id, slug, tip_webhook_enabled, tip_webhook_url")
      .eq("id", result.companyId)
      .maybeSingle(),
    db.from("ratings")
      .select("id, stars, feedback, customer_name, customer_phone, customer_email")
      .eq("id", result.ratingId)
      .maybeSingle(),
    db.from("review_contexts")
      .select("external_job_id, external_contact_id, customer_name, customer_phone, customer_email, dispatch_driver_name")
      .eq("rating_id", result.ratingId)
      .maybeSingle(),
    result.driverId
      ? db.from("drivers").select("id, slug, display_name").eq("id", result.driverId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!company || !rating) return;

  const { deliverReviewWebhook } = await import("./review-webhooks.server");
  const amount = (pi.amount / 100).toFixed(2);
  const tippedAt = result.tippedAt ?? (pi.created ? new Date(pi.created * 1000).toISOString() : new Date().toISOString());
  await deliverReviewWebhook(db, {
    ...company,
    review_webhook_enabled: company.tip_webhook_enabled,
    review_webhook_url: company.tip_webhook_url,
  }, {
    event: "tip.received",
    tipReceived: "Yes",
    tipId: result.tipId,
    ratingId: result.ratingId,
    companySlug: company.slug,
    jobId: reviewContext?.external_job_id ?? null,
    ghlContactId: reviewContext?.external_contact_id ?? null,
    driverId: result.driverId,
    driverName: driver?.display_name ?? reviewContext?.dispatch_driver_name ?? null,
    driverSlug: driver?.slug ?? null,
    tipAmountCents: pi.amount,
    tipAmount: amount,
    tipCurrency: (pi.currency || "usd").toUpperCase(),
    tippedAt,
    reviewStars: rating.stars,
    reviewText: rating.feedback ?? null,
    customerName: pi.metadata?.customer_name || rating.customer_name || reviewContext?.customer_name || null,
    customerPhone: pi.metadata?.customer_phone || rating.customer_phone || reviewContext?.customer_phone || null,
    customerEmail: pi.metadata?.customer_email || rating.customer_email || reviewContext?.customer_email || null,
  });
}
