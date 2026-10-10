import { createHash, createHmac, randomBytes } from "node:crypto";

export function hashReviewToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newReviewToken() {
  return randomBytes(32).toString("base64url");
}

export async function deliverReviewWebhook(db: any, company: any, payload: Record<string, unknown>) {
  const signingSecret = process.env.GHL_WEBHOOK_SECRET;
  if (!company.review_webhook_enabled || !company.review_webhook_url || !signingSecret) return;
  let deliveryId: string | null = null;
  try {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
    const { data: delivery, error: deliveryError } = await db.from("review_webhook_deliveries").insert({
      company_id: company.id, rating_id: payload.ratingId, destination_url: company.review_webhook_url,
    }).select("id").single();
    if (deliveryError || !delivery) throw new Error(deliveryError?.message ?? "Could not create webhook delivery");
    deliveryId = delivery.id;
    const response = await fetch(company.review_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bluecollartips-signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(8000),
    });
    await db.from("review_webhook_deliveries").update({
      status: response.ok ? "delivered" : "failed", response_status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`, delivered_at: response.ok ? new Date().toISOString() : null,
    }).eq("id", delivery.id);
  } catch (error) {
    if (deliveryId) await db.from("review_webhook_deliveries").update({
      status: "failed", error: error instanceof Error ? error.message : String(error),
    }).eq("id", deliveryId);
    console.error("review webhook delivery failed", error);
  }
}

/**
 * Job city/service columns for the GHL review-link upsert. A missing or blank
 * value is LEFT OUT, so a re-send for the same job never wipes a city or
 * service already stored on the link (the upsert only updates columns it is
 * given); a non-empty new value still replaces the old one.
 */
export function jobDetailColumns(city?: string | null, service?: string | null): { job_city?: string; job_service?: string } {
  const out: { job_city?: string; job_service?: string } = {};
  const c = (city ?? "").trim();
  const s = (service ?? "").trim();
  if (c) out.job_city = c;
  if (s) out.job_service = s;
  return out;
}
