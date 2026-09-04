import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function encryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is required");
  return createHash("sha256").update(raw).digest();
}

export function encryptWebhookSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptWebhookSecret(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function hashReviewToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newReviewToken() {
  return randomBytes(32).toString("base64url");
}

export async function deliverReviewWebhook(db: any, company: any, payload: Record<string, unknown>) {
  if (!company.review_webhook_enabled || !company.review_webhook_url || !company.review_webhook_secret_encrypted) return;
  let deliveryId: string | null = null;
  try {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", decryptWebhookSecret(company.review_webhook_secret_encrypted)).update(body).digest("hex");
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
