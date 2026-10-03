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
/** Review days are counted in this time zone (companies have no zone setting yet). */
export const VIP_TIME_ZONE = "America/New_York";

export async function vipReportRows(sql: Sql, args: {
  companyId: string;
  from?: string | null;
  to?: string | null;
  driverId?: string | null;
  /** Follow-ups due mode: customers whose next call is on or before this date (YYYY-MM-DD), any review date. */
  dueOn?: string | null;
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
           f.convini_registered_at, f.convini_registered_source, f.contacted_at, f.notes,
           to_char((r.created_at AT TIME ZONE ${VIP_TIME_ZONE})::date, 'YYYY-MM-DD') AS review_day,
           st.id AS assignee_id, st.name AS assignee_name,
           to_char(f.next_followup_on, 'YYYY-MM-DD') AS next_followup_on,
           COALESCE((SELECT array_agg(c.site ORDER BY c.clicked_at) FROM review_site_clicks c WHERE c.rating_id = r.id), '{}') AS review_sites_clicked,
           (SELECT COUNT(*) FROM vip_call_log cl WHERE cl.company_id = r.company_id AND cl.external_job_id = rc.external_job_id)::int AS call_count,
           CASE WHEN f.assignee_id IS NOT NULL THEN 'customer' WHEN da.staff_id IS NOT NULL THEN 'day' END AS assignee_source
    FROM ratings r
    JOIN review_contexts rc ON rc.id = r.review_context_id
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN vip_followups f ON f.company_id = r.company_id AND f.external_job_id = rc.external_job_id
    LEFT JOIN vip_day_assignments da ON da.company_id = r.company_id AND da.day = (r.created_at AT TIME ZONE ${VIP_TIME_ZONE})::date
    LEFT JOIN vip_followup_staff st ON st.id = COALESCE(f.assignee_id, da.staff_id)
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
      AND (${args.dueOn ?? null}::date IS NOT NULL OR ${args.from ?? null}::timestamptz IS NULL OR r.created_at >= ${args.from ?? null}::timestamptz)
      AND (${args.dueOn ?? null}::date IS NOT NULL OR ${args.to ?? null}::timestamptz IS NULL OR r.created_at <= ${args.to ?? null}::timestamptz)
      AND (${args.dueOn ?? null}::date IS NULL OR f.next_followup_on <= ${args.dueOn ?? null}::date)
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

export type VipStaff = { id: string; name: string; active: boolean };

export async function listVipStaff(sql: Sql, companyId: string): Promise<VipStaff[]> {
  const rows = await sql`
    SELECT id, name, active FROM vip_followup_staff
    WHERE company_id = ${companyId}
    ORDER BY active DESC, sort_order, lower(name)`;
  return rows.map((r: any) => ({ id: r.id, name: r.name, active: r.active }));
}

/** Day → assigned person, for days between `fromDay` and `toDay` (YYYY-MM-DD, inclusive). */
export async function vipDayAssignments(sql: Sql, companyId: string, fromDay: string, toDay: string) {
  const rows = await sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, staff_id FROM vip_day_assignments
    WHERE company_id = ${companyId} AND day BETWEEN ${fromDay}::date AND ${toDay}::date`;
  return Object.fromEntries(rows.map((r: any) => [r.day as string, r.staff_id as string])) as Record<string, string>;
}

/** Assign (or with `staffId` null, clear) the follow-up person for one review day. */
export async function assignVipDay(sql: Sql, args: { companyId: string; day: string; staffId: string | null; userId: string | null }) {
  if (!args.staffId) {
    await sql`DELETE FROM vip_day_assignments WHERE company_id = ${args.companyId} AND day = ${args.day}::date`;
    return;
  }
  const saved = await sql`
    INSERT INTO vip_day_assignments (company_id, day, staff_id, assigned_by)
    SELECT ${args.companyId}, ${args.day}::date, s.id, ${args.userId}
    FROM vip_followup_staff s WHERE s.id = ${args.staffId} AND s.company_id = ${args.companyId}
    ON CONFLICT (company_id, day) DO UPDATE SET staff_id = EXCLUDED.staff_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()
    RETURNING day`;
  if (!saved.length) throw new Error("Unknown follow-up person");
}

/** Reassign one customer (overrides the day); `staffId` null goes back to the day's person. */
export async function assignVipCustomer(sql: Sql, args: { companyId: string; jobId: string; staffId: string | null; userId: string | null }) {
  if (args.staffId) {
    const [ok] = await sql`SELECT 1 FROM vip_followup_staff WHERE id = ${args.staffId} AND company_id = ${args.companyId}`;
    if (!ok) throw new Error("Unknown follow-up person");
  }
  await sql`
    INSERT INTO vip_followups (company_id, external_job_id, assignee_id, assigned_at, updated_by)
    VALUES (${args.companyId}, ${args.jobId}, ${args.staffId}, now(), ${args.userId})
    ON CONFLICT (company_id, external_job_id) DO UPDATE SET
      assignee_id = EXCLUDED.assignee_id, assigned_at = now(), updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

/** How many customers have a follow-up call due on or before `dueOn`. */
export async function vipDueCount(sql: Sql, companyId: string, dueOn: string) {
  const [row] = await sql`
    SELECT COUNT(*)::int AS n FROM vip_followups f
    WHERE f.company_id = ${companyId} AND f.next_followup_on <= ${dueOn}::date
      AND EXISTS (SELECT 1 FROM review_contexts rc JOIN ratings r ON r.review_context_id = rc.id
                  WHERE rc.company_id = f.company_id AND rc.external_job_id = f.external_job_id)`;
  return Number(row?.n ?? 0);
}

export type VipCall = { id: string; calledAt: string; note: string | null; nextFollowupOn: string | null; loggedBy: string | null };

/** Recent calls for each job, newest first. */
export async function vipCallHistory(sql: Sql, companyId: string, jobIds: string[], perJob = 5) {
  if (!jobIds.length) return {} as Record<string, VipCall[]>;
  const rows = await sql`
    SELECT * FROM (
      SELECT cl.id, cl.external_job_id, cl.called_at, cl.note, to_char(cl.next_followup_on, 'YYYY-MM-DD') AS next_followup_on,
             u.full_name AS logged_by,
             row_number() OVER (PARTITION BY cl.external_job_id ORDER BY cl.called_at DESC) AS n
      FROM vip_call_log cl LEFT JOIN users u ON u.id = cl.logged_by
      WHERE cl.company_id = ${companyId} AND cl.external_job_id IN ${sql(jobIds)}
    ) x WHERE n <= ${perJob}
    ORDER BY called_at DESC`;
  const out: Record<string, VipCall[]> = {};
  for (const r of rows as any[]) {
    (out[r.external_job_id] ??= []).push({
      id: r.id, calledAt: new Date(r.called_at).toISOString(), note: r.note, nextFollowupOn: r.next_followup_on, loggedBy: r.logged_by ?? null,
    });
  }
  return out;
}

/** Log a follow-up call and set (or clear) when to call next. */
export async function logVipCall(sql: Sql, args: { companyId: string; jobId: string; note: string | null; nextFollowupOn: string | null; userId: string | null }) {
  // Works on a pool (opens a transaction) or inside one (savepoint).
  const atomic = (fn: (tx: any) => Promise<void>) => (typeof (sql as any).begin === "function" ? (sql as any).begin(fn) : (sql as any).savepoint(fn));
  await atomic(async (tx: any) => {
    await tx`
      INSERT INTO vip_call_log (company_id, external_job_id, called_at, note, next_followup_on, logged_by)
      VALUES (${args.companyId}, ${args.jobId}, clock_timestamp(), ${args.note}, ${args.nextFollowupOn}::date, ${args.userId})`;
    await tx`
      INSERT INTO vip_followups (company_id, external_job_id, contacted_at, next_followup_on, updated_by)
      VALUES (${args.companyId}, ${args.jobId}, now(), ${args.nextFollowupOn}::date, ${args.userId})
      ON CONFLICT (company_id, external_job_id) DO UPDATE SET
        contacted_at = now(), next_followup_on = EXCLUDED.next_followup_on,
        updated_by = EXCLUDED.updated_by, updated_at = now()`;
  });
}
