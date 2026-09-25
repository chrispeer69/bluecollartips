// VIP customer follow-up: the warm-lead path for customers who answered a GHL
// review request. Kept free of app aliases so tests can import it directly.
import type { Sql } from "postgres";
import type { VipEvent, VipReportRow } from "./vip.ts";

export { VIP_EVENTS, vipNextStep } from "./vip.ts";
export type { VipEvent, VipReportRow } from "./vip.ts";

export type VipLookup = {
  jobId?: string | null;
  ghlContactId?: string | null;
  phone?: string | null;
  email?: string | null;
};

const digits10 = (value?: string | null) => {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * Find the dispatch job an event belongs to. An explicit job # wins; otherwise
 * the most recent GHL review request for that contact, phone, or email.
 */
export async function resolveVipJob(sql: Sql, companyId: string, lookup: VipLookup): Promise<string | null> {
  const jobId = lookup.jobId?.trim();
  if (jobId) return jobId;
  const contactId = lookup.ghlContactId?.trim() || null;
  const phone = digits10(lookup.phone);
  const email = lookup.email?.trim().toLowerCase() || null;
  if (!contactId && !phone && !email) return null;
  const [row] = await sql`
    SELECT external_job_id FROM review_contexts
    WHERE company_id = ${companyId}
      AND (
        (${contactId}::text IS NOT NULL AND external_contact_id = ${contactId}::text)
        OR (${phone}::text IS NOT NULL AND right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 10) = ${phone}::text)
        OR (${email}::text IS NOT NULL AND lower(customer_email) = ${email}::text)
      )
    ORDER BY (external_contact_id IS NOT DISTINCT FROM ${contactId}::text) DESC, created_at DESC
    LIMIT 1`;
  return row?.external_job_id ?? null;
}

/**
 * Record one automated event. First-time timestamps are kept (COALESCE) so a
 * repeat send or click never erases when the lead first engaged.
 */
export async function recordVipEvent(sql: Sql, args: {
  companyId: string;
  jobId: string;
  event: VipEvent;
  at?: Date;
  stars?: number | null;
  source?: "ghl" | "convini";
}) {
  const at = args.at ?? new Date();
  const { companyId, jobId } = args;
  switch (args.event) {
    case "convini_link_sent":
      await sql`
        INSERT INTO vip_followups (company_id, external_job_id, convini_link_sent_at, convini_link_last_sent_at, convini_link_sent_count)
        VALUES (${companyId}, ${jobId}, ${at}, ${at}, 1)
        ON CONFLICT (company_id, external_job_id) DO UPDATE SET
          convini_link_sent_at = COALESCE(vip_followups.convini_link_sent_at, EXCLUDED.convini_link_sent_at),
          convini_link_last_sent_at = GREATEST(vip_followups.convini_link_last_sent_at, EXCLUDED.convini_link_last_sent_at),
          convini_link_sent_count = vip_followups.convini_link_sent_count + 1,
          updated_at = now()`;
      return;
    case "convini_clicked":
      await sql`
        INSERT INTO vip_followups (company_id, external_job_id, convini_clicked_at, convini_last_clicked_at, convini_click_count)
        VALUES (${companyId}, ${jobId}, ${at}, ${at}, 1)
        ON CONFLICT (company_id, external_job_id) DO UPDATE SET
          convini_clicked_at = COALESCE(vip_followups.convini_clicked_at, EXCLUDED.convini_clicked_at),
          convini_last_clicked_at = GREATEST(vip_followups.convini_last_clicked_at, EXCLUDED.convini_last_clicked_at),
          convini_click_count = LEAST(vip_followups.convini_click_count + 1, 1000000),
          updated_at = now()`;
      return;
    case "convini_registered":
      await sql`
        INSERT INTO vip_followups (company_id, external_job_id, convini_registered_at, convini_registered_source)
        VALUES (${companyId}, ${jobId}, ${at}, ${args.source ?? "ghl"})
        ON CONFLICT (company_id, external_job_id) DO UPDATE SET
          convini_registered_at = COALESCE(vip_followups.convini_registered_at, EXCLUDED.convini_registered_at),
          convini_registered_source = COALESCE(vip_followups.convini_registered_source, EXCLUDED.convini_registered_source),
          updated_at = now()`;
      return;
    case "google_clicked":
      await sql`
        INSERT INTO vip_followups (company_id, external_job_id, google_clicked_at)
        VALUES (${companyId}, ${jobId}, ${at})
        ON CONFLICT (company_id, external_job_id) DO UPDATE SET
          google_clicked_at = COALESCE(vip_followups.google_clicked_at, EXCLUDED.google_clicked_at),
          updated_at = now()`;
      return;
    case "google_review_posted":
      await sql`
        INSERT INTO vip_followups (company_id, external_job_id, google_posted_at, google_stars)
        VALUES (${companyId}, ${jobId}, ${at}, ${args.stars ?? null})
        ON CONFLICT (company_id, external_job_id) DO UPDATE SET
          google_posted_at = COALESCE(vip_followups.google_posted_at, EXCLUDED.google_posted_at),
          google_stars = COALESCE(EXCLUDED.google_stars, vip_followups.google_stars),
          updated_at = now()`;
      return;
  }
}


/**
 * Customers who answered a GHL review request (their review came in through a
 * job-specific link) within the range, with tip and follow-up status.
 * Tips link to the review directly; older tips that predate that link are
 * matched by employee + customer phone/email within a day of the review.
 */
export async function vipReportRows(sql: Sql, args: {
  companyId: string;
  from?: string | null;
  to?: string | null;
  driverId?: string | null;
  limit?: number;
}): Promise<VipReportRow[]> {
  const rows = await sql`
    SELECT r.id AS rating_id, rc.external_job_id AS job_id, rc.external_contact_id AS ghl_contact_id,
           rc.created_at AS review_requested_at, r.created_at AS reviewed_at, r.stars, r.feedback,
           COALESCE(NULLIF(BTRIM(r.customer_name), ''), rc.customer_name) AS customer_name,
           COALESCE(NULLIF(BTRIM(r.customer_phone), ''), rc.customer_phone) AS customer_phone,
           COALESCE(NULLIF(BTRIM(r.customer_email), ''), rc.customer_email) AS customer_email,
           r.driver_id, d.display_name AS driver_name,
           tip.tip_count, tip.tip_total_cents, tip.tip_first_at, tip.tip_refunded,
           f.google_clicked_at, f.google_posted_at, f.google_stars,
           f.convini_link_sent_at, f.convini_link_last_sent_at, COALESCE(f.convini_link_sent_count, 0) AS convini_link_sent_count,
           f.convini_clicked_at, f.convini_last_clicked_at, COALESCE(f.convini_click_count, 0) AS convini_click_count,
           f.convini_registered_at, f.convini_registered_source, f.contacted_at, f.notes
    FROM ratings r
    JOIN review_contexts rc ON rc.id = r.review_context_id
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN vip_followups f ON f.company_id = r.company_id AND f.external_job_id = rc.external_job_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS tip_count,
             COALESCE(sum(t.amount_cents), 0)::int AS tip_total_cents,
             min(t.created_at) AS tip_first_at,
             COALESCE(bool_or(t.refunded_at IS NOT NULL OR t.disputed), false) AS tip_refunded
      FROM tips t
      WHERE t.company_id = r.company_id
        AND (
          t.rating_id = r.id
          OR (
            t.rating_id IS NULL
            AND t.driver_id IS NOT DISTINCT FROM r.driver_id
            AND t.created_at BETWEEN r.created_at - interval '1 day' AND r.created_at + interval '1 day'
            AND t.customer_contact IS NOT NULL
            AND (
              lower(BTRIM(t.customer_contact)) = lower(COALESCE(NULLIF(BTRIM(r.customer_email), ''), rc.customer_email, '-'))
              OR (
                length(regexp_replace(t.customer_contact, '\\D', '', 'g')) >= 10
                AND right(regexp_replace(t.customer_contact, '\\D', '', 'g'), 10)
                  = right(regexp_replace(COALESCE(NULLIF(BTRIM(r.customer_phone), ''), rc.customer_phone, ''), '\\D', '', 'g'), 10)
              )
            )
          )
        )
    ) tip ON true
    WHERE r.company_id = ${args.companyId}
      AND (${args.driverId ?? null}::uuid IS NULL OR r.driver_id = ${args.driverId ?? null}::uuid)
      AND (${args.from ?? null}::timestamptz IS NULL OR r.created_at >= ${args.from ?? null}::timestamptz)
      AND (${args.to ?? null}::timestamptz IS NULL OR r.created_at <= ${args.to ?? null}::timestamptz)
    ORDER BY r.created_at DESC
    LIMIT ${args.limit ?? 1000}`;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r: any) => ({
    ...r,
    review_requested_at: iso(r.review_requested_at)!,
    reviewed_at: iso(r.reviewed_at)!,
    tip_first_at: iso(r.tip_first_at),
    google_clicked_at: iso(r.google_clicked_at),
    google_posted_at: iso(r.google_posted_at),
    convini_link_sent_at: iso(r.convini_link_sent_at),
    convini_link_last_sent_at: iso(r.convini_link_last_sent_at),
    convini_clicked_at: iso(r.convini_clicked_at),
    convini_last_clicked_at: iso(r.convini_last_clicked_at),
    convini_registered_at: iso(r.convini_registered_at),
    contacted_at: iso(r.contacted_at),
  })) as VipReportRow[];
}
