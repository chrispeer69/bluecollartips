// Private company review feed: GET /api/private/reviews/:companySlug
// For a company's OWN website, server-to-server only (no CORS). Unlike the
// public feed (stars/date/text/customer only), it carries each review's
// employee FIRST NAME, opaque employee key, pickup city, service and the
// verified flag.
//
// Auth: "Authorization: Bearer <token>". Only a SHA-256 hash of each company's
// token is stored, in an env var (same place as GHL_WEBHOOK_SECRET and
// PARTNER_API_KEY), so a leaked env dump or DB dump never reveals a usable token:
//   PRIVATE_REVIEW_FEED_TOKENS="roadside-towing:<64-hex sha256 of the token>[,other-co:<hex>]"
// No entry for a slug -> the feed is off for that company (404).
// Kept free of app aliases so tests can import it directly.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import { driverKey, firstNameOnly, toPrivateCompanyReview, type ReviewFeedRow } from "./public-reviews.ts";

export const PRIVATE_FEED_MIN_TOKEN_LENGTH = 32;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Parses PRIVATE_REVIEW_FEED_TOKENS into slug -> 32-byte SHA-256 digest. Bad entries are ignored. */
export function privateFeedTokenHashes(env = process.env.PRIVATE_REVIEW_FEED_TOKENS ?? ""): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  for (const entry of env.split(",")) {
    const i = entry.indexOf(":");
    if (i < 0) continue;
    const slug = entry.slice(0, i).trim().toLowerCase();
    const hex = entry.slice(i + 1).trim().toLowerCase();
    if (SLUG.test(slug) && HEX64.test(hex)) map.set(slug, Buffer.from(hex, "hex"));
  }
  return map;
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type PrivateFeedAuth = "off" | "unauthorized" | "ok";

/**
 * "off" when no token hash is configured for the slug; "ok" only when the
 * bearer token's SHA-256 equals the configured hash (constant-time compare of
 * two fixed-length digests, so token length is not leaked either).
 */
export function privateFeedAuth(slug: string, authorization: string | null, env?: string): PrivateFeedAuth {
  const expected = privateFeedTokenHashes(env).get(slug);
  if (!expected) return "off";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  const token = match?.[1] ?? "";
  const provided = createHash("sha256").update(token, "utf8").digest();
  const equal = timingSafeEqual(provided, expected);
  return equal && token.length >= PRIVATE_FEED_MIN_TOKEN_LENGTH ? "ok" : "unauthorized";
}

/** Failed-auth limiter per client IP (in memory, per process). */
export function createFailureLimiter(maxFailures = 10, windowMs = 15 * 60 * 1000) {
  const hits = new Map<string, { count: number; start: number }>();
  return {
    blocked(ip: string, now = Date.now()) {
      const h = hits.get(ip);
      if (!h || now - h.start > windowMs) return false;
      return h.count >= maxFailures;
    },
    fail(ip: string, now = Date.now()) {
      const h = hits.get(ip);
      if (!h || now - h.start > windowMs) hits.set(ip, { count: 1, start: now });
      else h.count++;
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      }
    },
  };
}

export function clientIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export type PrivateFeedDriver = { key: string; name: string; photoUrl: string | null };

const absolutePhoto = (origin: string, u: string | null) =>
  !u ? null : /^https?:\/\//.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`;

/** Builds the private feed payload for one (already authorized, active) company. */
export async function privateFeedBody(sql: Sql, company: { id: string; name: string; slug: string }, origin: string) {
  const [rows, drivers] = await Promise.all([
    sql`
      SELECT r.id, r.stars, r.created_at, r.feedback, r.customer_name, r.public_ok,
             r.review_context_id, r.dispatch_match,
             COALESCE(r.job_city, rc.job_city) AS job_city,
             COALESCE(r.job_service, rc.job_service) AS job_service,
             d.slug AS driver_slug, d.display_name AS driver_name, d.status AS driver_status
      FROM ratings r
      LEFT JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.company_id = ${company.id}
      ORDER BY r.created_at DESC
      LIMIT 5000`,
    sql`
      SELECT slug, display_name, photo_url
      FROM drivers
      WHERE company_id = ${company.id} AND status = 'active'
      ORDER BY display_name`,
  ]);
  return {
    company: { name: company.name, slug: company.slug },
    generatedAt: new Date().toISOString(),
    publicTextSince: "2026-09-28",
    drivers: (drivers as unknown as Array<{ slug: string; display_name: string; photo_url: string | null }>)
      .map((d) => ({ key: driverKey(d.slug), name: firstNameOnly(d.display_name), photoUrl: absolutePhoto(origin, d.photo_url) }))
      .filter((d): d is PrivateFeedDriver => Boolean(d.name)),
    reviews: (rows as unknown as ReviewFeedRow[]).map(toPrivateCompanyReview),
  };
}
