import { createHash } from "node:crypto";
import { sql } from "@/db/client.server";

const DRIVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 30;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "bct_session") return value.join("=") || null;
  }
  return null;
}

async function authenticatedUserId(request: Request): Promise<string | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [session] = await sql()`
    SELECT user_id
    FROM sessions
    WHERE token_hash = ${tokenHash} AND expires_at > now()
    LIMIT 1
  `;
  return session?.user_id ?? null;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;
  try {
    const allowedOrigins = new Set<string>([new URL(request.url).origin]);

    for (const configuredUrl of [process.env.APP_PUBLIC_URL, process.env.APP_BASE_URL]) {
      if (!configuredUrl?.trim()) continue;
      allowedOrigins.add(new URL(configuredUrl.trim()).origin);
    }

    // Railway terminates TLS before forwarding the request to the app, so
    // request.url may contain an internal HTTP origin. Reconstruct the public
    // origin from the proxy headers instead of rejecting a legitimate upload.
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0].trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
    const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
    if (host && (protocol === "https" || protocol === "http")) {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    }

    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function canEditDriver(userId: string, driverId: string): Promise<boolean> {
  const [driver] =
    await sql()`SELECT user_id, company_id FROM drivers WHERE id = ${driverId} LIMIT 1`;
  if (!driver) return false;
  if (driver.user_id === userId) return true;
  const [role] = await sql()`
    SELECT 1
    FROM user_roles
    WHERE user_id = ${userId}
      AND (role = 'super_admin' OR (role = 'company_admin' AND company_id = ${driver.company_id}))
    LIMIT 1
  `;
  return !!role;
}

async function consumeUploadAllowance(userId: string): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  await sql()`DELETE FROM profile_photo_upload_rate_limits WHERE window_start < now() - interval '7 days'`;
  const [bucket] = await sql()`
    INSERT INTO profile_photo_upload_rate_limits (user_id, window_start, count)
    VALUES (${userId}, ${windowStart}, 1)
    ON CONFLICT (user_id, window_start)
    DO UPDATE SET count = profile_photo_upload_rate_limits.count + 1
    RETURNING count
  `;
  return Number(bucket?.count ?? MAX_UPLOADS_PER_HOUR + 1) <= MAX_UPLOADS_PER_HOUR;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    return null;
  let offset = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

async function getPhoto(request: Request, driverId: string) {
  const [photo] = await sql()`
    SELECT image_data, content_type, byte_size, updated_at
    FROM profile_photos
    WHERE driver_id = ${driverId}
    LIMIT 1
  `;
  if (!photo) return new Response("Not found", { status: 404 });
  const etag = `"profile-${driverId}-${new Date(photo.updated_at).getTime()}-${photo.byte_size}"`;
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(request.method === "HEAD" ? null : Uint8Array.from(photo.image_data), {
    headers: {
      "Content-Type": photo.content_type,
      "Content-Length": String(photo.byte_size),
      "Cache-Control": new URL(request.url).searchParams.has("v")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

async function savePhoto(request: Request, driverId: string, userId: string) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "image/jpeg") {
    return jsonError("Only the cropped JPEG produced by the photo editor is accepted.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength <= 0 ||
    declaredLength > MAX_STORED_BYTES
  ) {
    return jsonError("Processed image is too large.", 413);
  }
  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_STORED_BYTES)
    return jsonError("Processed image is too large.", 413);
  const bytes = new Uint8Array(buffer);
  const dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.width !== 512 || dimensions.height !== 512) {
    return jsonError("Invalid image. Please crop the picture again.", 400);
  }
  if (!(await consumeUploadAllowance(userId)))
    return jsonError("Too many picture changes. Please try again later.", 429);

  const updatedAt = new Date();
  await sql().begin(async (tx) => {
    await tx`
      INSERT INTO profile_photos (driver_id, image_data, content_type, byte_size, width, height, updated_by, updated_at)
      VALUES (${driverId}, ${Buffer.from(bytes)}, 'image/jpeg', ${bytes.byteLength}, 512, 512, ${userId}, ${updatedAt})
      ON CONFLICT (driver_id) DO UPDATE SET
        image_data = EXCLUDED.image_data,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    `;
    await tx`UPDATE drivers SET photo_url = ${`/api/profile-photos/${driverId}?v=${updatedAt.getTime()}`} WHERE id = ${driverId}`;
  });
  return Response.json(
    { photoUrl: `/api/profile-photos/${driverId}?v=${updatedAt.getTime()}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function deletePhoto(driverId: string, userId: string) {
  if (!(await consumeUploadAllowance(userId)))
    return jsonError("Too many picture changes. Please try again later.", 429);
  await sql().begin(async (tx) => {
    await tx`DELETE FROM profile_photos WHERE driver_id = ${driverId}`;
    await tx`UPDATE drivers SET photo_url = NULL WHERE id = ${driverId}`;
  });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function handleProfilePhotoRequest(request: Request): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/profile-photos\/([^/]+)$/);
  if (!match) return null;
  const driverId = decodeURIComponent(match[1]);
  if (!DRIVER_ID.test(driverId)) return jsonError("Invalid employee ID.", 400);
  if (request.method === "GET" || request.method === "HEAD") return getPhoto(request, driverId);
  if (request.method !== "POST" && request.method !== "DELETE")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD, POST, DELETE" },
    });
  if (!isSameOrigin(request)) return jsonError("Invalid upload origin.", 403);
  const userId = await authenticatedUserId(request);
  if (!userId) return jsonError("Please sign in again.", 401);
  if (!(await canEditDriver(userId, driverId)))
    return jsonError("You do not have permission to change this picture.", 403);
  return request.method === "POST"
    ? savePhoto(request, driverId, userId)
    : deletePhoto(driverId, userId);
}
