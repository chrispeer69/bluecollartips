// Partner rating feed for US Tow Jobs (drivingjobs.online): every customer
// rating becomes part of the driver's employment record there.
//   Pull: GET /api/partner/driver-ratings (Bearer PARTNER_API_KEY)
//   Push: signed webhook to PARTNER_WEBHOOK_URL for each new/changed/removed rating
// Only companies listed in PARTNER_API_SLUGS are shared.
// Kept free of app aliases so tests can import it directly.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import { firstNameLastInitial, scrubContact } from "./public-reviews.ts";

export type PartnerDriver = {
  bctDriverId: string;
  name: string;
  email: string | null;
  phone: string | null;
  employeeId: string | null;
  status: string;
  photoUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type PartnerRating = {
  id: string;
  bctDriverId: string | null;
  stars: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  status: "active" | "removed";
  towbookJobId: string | null;
  jobCity: string | null;
  jobService: string | null;
  customerFirstNameLastInitial: string | null;
};

export function partnerSlugs(env = process.env.PARTNER_API_SLUGS ?? ""): string[] {
  return env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Constant-time check of "Authorization: Bearer <key>" against PARTNER_API_KEY. */
export function partnerKeyValid(authorization: string | null, key = process.env.PARTNER_API_KEY ?? ""): boolean {
  if (key.length < 24) return false; // feed stays off until a strong key is set
  const provided = (authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** X-BCT-Signature value: sha256=<hex HMAC-SHA256(secret, timestamp + "." + rawBody)>. */
export function signPartnerBody(secret: string, timestamp: number, rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const absolute = (origin: string, u: string | null) => (!u ? null : /^https?:\/\//.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`);
const comment = (text: string | null | undefined) => {
  const t = (text ?? "").trim();
  return t ? scrubContact(t) : null;
};

export async function partnerDrivers(sql: Sql, companyId: string, origin: string, onlyIds?: string[]): Promise<PartnerDriver[]> {
  const rows = await sql`
    SELECT d.id, d.display_name, d.email, d.phone, d.employee_id, d.status, d.photo_url,
           ROUND(AVG(r.stars)::numeric, 2)::float AS rating_avg, COUNT(r.id)::int AS rating_count
    FROM drivers d LEFT JOIN ratings r ON r.driver_id = d.id
    WHERE d.company_id = ${companyId}
      ${onlyIds ? sql`AND d.id IN ${sql(onlyIds.length ? onlyIds : ["00000000-0000-0000-0000-000000000000"])}` : sql``}
    GROUP BY d.id
    ORDER BY d.display_name`;
  return rows.map((d: any) => ({
    bctDriverId: d.id,
    name: d.display_name,
    email: d.email ? String(d.email).trim().toLowerCase() : null,
    phone: d.phone ?? null,
    employeeId: d.employee_id ?? null,
    status: d.status,
    photoUrl: absolute(origin, d.photo_url ?? null),
    ratingAvg: d.rating_count ? Number(d.rating_avg) : null,
    ratingCount: Number(d.rating_count),
  }));
}

function ratingFromRow(r: any, status: "active" | "removed"): PartnerRating {
  return {
    id: r.id,
    bctDriverId: r.driver_id ?? null,
    stars: Number(r.stars ?? 0),
    comment: comment(r.feedback),
    createdAt: iso(r.created_at ?? r.changed_at ?? r.updated_at)!,
    updatedAt: iso(r.changed_at ?? r.updated_at ?? r.created_at)!,
    status,
    towbookJobId: r.job_id ?? null,
    jobCity: r.job_city ?? null,
    jobService: r.job_service ?? null,
    customerFirstNameLastInitial: firstNameLastInitial(r.customer_name),
  };
}

/** One rating as it is now (null if it no longer exists). */
export async function partnerRating(sql: Sql, ratingId: string): Promise<(PartnerRating & { companyId: string }) | null> {
  const [r] = await sql`
    SELECT r.id, r.company_id, r.driver_id, r.stars, r.feedback, r.created_at, r.updated_at,
           COALESCE(NULLIF(BTRIM(r.customer_name), ''), rc.customer_name) AS customer_name,
           rc.external_job_id AS job_id, COALESCE(r.job_city, rc.job_city) AS job_city, COALESCE(r.job_service, rc.job_service) AS job_service
    FROM ratings r LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
    WHERE r.id = ${ratingId}`;
  return r ? { ...ratingFromRow(r, "active"), companyId: r.company_id } : null;
}

/** A deleted rating, from the snapshot taken when it was removed. */
export function removedRating(snapshot: any, removedAt: string | Date): PartnerRating {
  return ratingFromRow({ ...snapshot, job_id: null, changed_at: removedAt }, "removed");
}

type Cursor = { at: string; id: string };
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof c?.at === "string" && typeof c?.id === "string" && !Number.isNaN(Date.parse(c.at))) return c;
  } catch { /* fall through */ }
  throw new Error("Invalid cursor");
}

/**
 * Ratings (and removals) changed since `since`, oldest change first, paged by
 * a cursor. Pass back `serverTime` as the next `since` after the last page.
 */
export async function partnerFeedPage(sql: Sql, args: {
  companyId: string;
  origin: string;
  since?: string | null;
  cursor?: string | null;
  limit?: number;
}) {
  const [{ now }] = await sql`SELECT now() AS now`;
  const limit = Math.min(Math.max(args.limit ?? 500, 1), 1000);
  const cursor = decodeCursor(args.cursor);
  const since = args.since ?? null;
  const rows = await sql`
    -- changed_key: the exact change time as text (JS Dates stop at milliseconds,
    -- Postgres keeps microseconds), so the cursor never repeats or skips a row.
    SELECT x.*, to_char(x.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_key FROM (
      SELECT 'active' AS kind, r.id, r.driver_id, r.stars, r.feedback, r.created_at, r.updated_at AS changed_at,
             COALESCE(NULLIF(BTRIM(r.customer_name), ''), rc.customer_name) AS customer_name,
             rc.external_job_id AS job_id, COALESCE(r.job_city, rc.job_city) AS job_city,
             COALESCE(r.job_service, rc.job_service) AS job_service, NULL::jsonb AS snapshot
      FROM ratings r LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.company_id = ${args.companyId}
        AND (${since}::timestamptz IS NULL OR r.updated_at >= ${since}::timestamptz OR r.created_at >= ${since}::timestamptz)
      UNION ALL
      SELECT 'removed', t.rating_id, t.driver_id, NULL, NULL, NULL, t.removed_at, NULL, NULL, NULL, NULL, t.snapshot
      FROM partner_rating_tombstones t
      WHERE t.company_id = ${args.companyId}
        AND (${since}::timestamptz IS NULL OR t.removed_at >= ${since}::timestamptz)
    ) x
    -- Cursor time goes in as text: the driver would round a timestamptz parameter to milliseconds.
    WHERE (${cursor?.at ?? null}::text IS NULL OR (x.changed_at, x.id) > (${cursor?.at ?? null}::text::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY x.changed_at, x.id
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit) as any[];
  const ratings = page.map((r) => (r.kind === "removed" ? removedRating(r.snapshot ?? { id: r.id, driver_id: r.driver_id }, r.changed_at) : ratingFromRow(r, "active")));
  const last = page[page.length - 1];
  return {
    drivers: await partnerDrivers(sql, args.companyId, args.origin),
    ratings,
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.changed_key, id: last.id }) : null,
    serverTime: new Date(now).toISOString(),
  };
}

const MAX_ATTEMPTS = 15;
/** Retry schedule: 1, 2, 4 … minutes, capped at 6 hours. */
export const retryDelayMs = (attempts: number) => Math.min(2 ** Math.max(attempts - 1, 0) * 60_000, 6 * 3_600_000);

/**
 * Send due webhook events. Returns counts for logging/tests. `fetchImpl` is
 * injectable for tests. Companies not in PARTNER_API_SLUGS are skipped.
 */
export async function dispatchPartnerEvents(sql: Sql, opts: {
  url: string;
  secret: string;
  slugs: string[];
  origin: string;
  fetchImpl?: typeof fetch;
  batch?: number;
  now?: () => number;
}) {
  const doFetch = opts.fetchImpl ?? fetch;
  const nowMs = opts.now ?? Date.now;
  // Claim a batch so a second sender can't pick the same events.
  const claimed = await sql`
    UPDATE partner_rating_events e SET next_attempt_at = now() + interval '5 minutes'
    WHERE e.id IN (
      SELECT id FROM partner_rating_events
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY id LIMIT ${opts.batch ?? 25}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e.id, e.company_id, e.rating_id, e.event, e.snapshot, e.attempts, e.created_at`;
  const result = { sent: 0, failed: 0, skipped: 0, retry: 0 };
  for (const ev of claimed as any[]) {
    const [company] = await sql`SELECT slug FROM companies WHERE id = ${ev.company_id}`;
    if (!company || !opts.slugs.includes(String(company.slug).toLowerCase())) {
      await sql`UPDATE partner_rating_events SET status = 'skipped' WHERE id = ${ev.id}`;
      result.skipped += 1;
      continue;
    }
    let event = ev.event as string;
    let rating: PartnerRating | null = null;
    if (event !== "rating.removed") {
      const current = await partnerRating(sql, ev.rating_id);
      if (current) {
        const { companyId: _c, ...rest } = current;
        rating = rest;
      }
    }
    if (!rating) {
      // Deleted before we could send it: tell the partner it's gone.
      const [t] = await sql`SELECT snapshot, removed_at FROM partner_rating_tombstones WHERE rating_id = ${ev.rating_id}`;
      rating = removedRating(ev.snapshot ?? t?.snapshot ?? { id: ev.rating_id, created_at: ev.created_at, stars: 0 }, t?.removed_at ?? ev.created_at);
      event = "rating.removed";
    }
    const [driver] = rating.bctDriverId ? await partnerDrivers(sql, ev.company_id, opts.origin, [rating.bctDriverId]) : [];
    const body = JSON.stringify({ event, companySlug: company.slug, driver: driver ?? null, rating });
    const ts = Math.floor(nowMs() / 1000);
    let error: string | null = null;
    try {
      const res = await doFetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bct-timestamp": String(ts),
          "x-bct-signature": signPartnerBody(opts.secret, ts, body),
          "x-bct-event-id": String(ev.id),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (!error) {
      await sql`UPDATE partner_rating_events SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${ev.id}`;
      result.sent += 1;
    } else if (ev.attempts + 1 >= MAX_ATTEMPTS) {
      await sql`UPDATE partner_rating_events SET status = 'failed', attempts = attempts + 1, last_error = ${error.slice(0, 500)} WHERE id = ${ev.id}`;
      result.failed += 1;
    } else {
      const next = new Date(nowMs() + retryDelayMs(ev.attempts + 1));
      await sql`UPDATE partner_rating_events SET attempts = attempts + 1, last_error = ${error.slice(0, 500)}, next_attempt_at = ${next} WHERE id = ${ev.id}`;
      result.retry += 1;
    }
  }
  return result;
}

/** Drop delivered/skipped events after 30 days. */
export async function purgePartnerEvents(sql: Sql) {
  await sql`DELETE FROM partner_rating_events WHERE status IN ('sent', 'skipped') AND created_at < now() - interval '30 days'`;
}
