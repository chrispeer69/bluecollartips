import { timingSafeEqual } from "crypto";

/** Shared-secret check for inbound GHL (and partner) webhooks. */
export function verifyGhlSecret(request: Request): boolean {
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
