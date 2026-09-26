// Validation for support-chat screenshots. No app imports, so tests can load it.

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export type AttachmentUpload = { dataBase64: string };
export type DecodedImage = { bytes: Buffer; contentType: "image/png" | "image/jpeg" | "image/webp" };

/** Identify an image by its first bytes; never trust the browser's label. */
export function sniffImage(bytes: Uint8Array): DecodedImage["contentType"] | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export function decodeAttachments(list: AttachmentUpload[] | undefined): DecodedImage[] {
  if (!list?.length) return [];
  if (list.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} pictures per message.`);
  return list.map(({ dataBase64 }) => {
    const bytes = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ""), "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("A picture is too large (3 MB max).");
    const contentType = sniffImage(bytes);
    if (!contentType) throw new Error("Only PNG, JPEG or WebP pictures can be attached.");
    return { bytes, contentType };
  });
}
