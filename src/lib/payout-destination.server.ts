import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const secret = process.env.PAYOUT_DETAILS_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("PAYOUT_DETAILS_ENCRYPTION_KEY must be configured with at least 32 characters");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptPayoutDetails(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptPayoutDetails(value: string | null | undefined) {
  if (!value) return null;
  const [version, encodedIv, encodedTag, encodedValue] = value.split(":");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedValue)
    throw new Error("Stored payout details are invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
