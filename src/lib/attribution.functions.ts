import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { last10, matchDriver, normText, type DriverCandidate } from "./driver-match";

// ---------------------------------------------------------------------------
// Attribute company-level ratings to employees from a dispatch export
// (TowBook "Dispatching Analysis" or any CSV with job / driver / customer).
//
// The browser parses the spreadsheet into plain job rows; the server matches
// each unattributed rating to a job (job id → phone → email → name, nearest
// date), then maps the job's driver to an employee with the same matcher the
// webhook uses. Nothing is written until the admin confirms.
// ---------------------------------------------------------------------------

const jobSchema = z.object({
  jobId: z.string().trim().max(60).nullable(),
  driver: z.string().trim().max(120).nullable(),
  customerName: z.string().trim().max(200).nullable(),
  customerPhone: z.string().trim().max(60).nullable(),
  customerEmail: z.string().trim().max(200).nullable(),
  completedAt: z.string().trim().max(40).nullable(), // ISO date/time
  city: z.string().trim().max(120).nullable().optional(),
  service: z.string().trim().max(120).nullable().optional(),
});
export type DispatchJob = z.infer<typeof jobSchema>;

async function requireCompanyAdmin(userId: string, companyId: string) {
  const { db } = await import("@/db/client.server");
  const { data: roles } = await db.from("user_roles").select("role, company_id").eq("user_id", userId);
  const ok = roles?.some((r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === companyId));
  if (!ok) throw new Error("Forbidden");
}

const DAY = 86_400_000;

export const previewRatingAttribution = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), jobs: z.array(jobSchema).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const ratings = await database`
      SELECT r.id, r.stars, r.created_at, r.customer_name, r.customer_phone, r.customer_email, LEFT(r.feedback, 80) AS feedback,
             rc.external_job_id, rc.dispatch_driver_name,
             rc.customer_name AS ctx_name, rc.customer_phone AS ctx_phone, rc.customer_email AS ctx_email
      FROM ratings r
      LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.company_id = ${data.companyId} AND r.driver_id IS NULL
      ORDER BY r.created_at DESC`;
    const employees = (await database`
      SELECT id, slug, display_name, email, phone, status FROM drivers WHERE company_id = ${data.companyId}`) as unknown as DriverCandidate[];

    const jobs = data.jobs.filter((j) => j.driver);
    const byJobId = new Map<string, DispatchJob[]>();
    const byPhone = new Map<string, DispatchJob[]>();
    const byEmail = new Map<string, DispatchJob[]>();
    const byName = new Map<string, DispatchJob[]>();
    const push = (m: Map<string, DispatchJob[]>, k: string | null | undefined, j: DispatchJob) => {
      if (!k) return;
      const list = m.get(k) ?? [];
      list.push(j);
      m.set(k, list);
    };
    for (const j of jobs) {
      push(byJobId, j.jobId ? j.jobId.replace(/^#/, "").trim() : null, j);
      const p = j.customerPhone ? last10(j.customerPhone) : "";
      push(byPhone, p.length >= 7 ? p : null, j);
      push(byEmail, j.customerEmail ? normText(j.customerEmail) : null, j);
      push(byName, j.customerName ? normText(j.customerName) : null, j);
    }

    // Among candidate jobs, prefer the one completed closest before the rating
    // (within 21 days); a rating cannot precede its job by more than a day.
    const nearest = (cands: DispatchJob[] | undefined, ratedAt: Date) => {
      if (!cands?.length) return null;
      let best: { job: DispatchJob; gap: number } | null = null;
      for (const job of cands) {
        const t = job.completedAt ? Date.parse(job.completedAt) : NaN;
        const gap = Number.isNaN(t) ? 10 * DAY : ratedAt.getTime() - t; // unknown date = weak but allowed
        if (gap < -DAY || gap > 21 * DAY) continue;
        if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { job, gap };
      }
      return best?.job ?? (cands.length === 1 ? cands[0] : null);
    };

    const rows = ratings.map((r: any) => {
      const ratedAt = new Date(r.created_at);
      const jobId = r.external_job_id ? String(r.external_job_id).replace(/^#/, "").trim() : null;
      const phone = last10(r.customer_phone ?? r.ctx_phone ?? "");
      const email = normText(r.customer_email ?? r.ctx_email ?? "");
      const name = normText(r.customer_name ?? r.ctx_name ?? "");
      // Some job ids carry a suffix like "127154-2"; try the bare number too.
      const jobKeys = jobId ? [jobId, jobId.split(/[-_ ]/)[0]] : [];
      let job: DispatchJob | null = null;
      let via: "job" | "phone" | "email" | "name" | "dispatch" | null = null;
      for (const k of jobKeys) {
        const j = nearest(byJobId.get(k), ratedAt);
        if (j) { job = j; via = "job"; break; }
      }
      if (!job && phone.length >= 7) { const j = nearest(byPhone.get(phone), ratedAt); if (j) { job = j; via = "phone"; } }
      if (!job && email) { const j = nearest(byEmail.get(email), ratedAt); if (j) { job = j; via = "email"; } }
      if (!job && name) { const j = nearest(byName.get(name), ratedAt); if (j) { job = j; via = "name"; } }

      const driverName = job?.driver ?? r.dispatch_driver_name ?? null;
      if (!job && r.dispatch_driver_name) via = "dispatch";
      const employee = driverName ? matchDriver(employees, { name: driverName }) : null;
      return {
        ratingId: r.id as string,
        stars: Number(r.stars),
        ratedAt: String(r.created_at),
        customer: r.customer_name ?? r.ctx_name ?? null,
        feedback: r.feedback ?? null,
        jobId,
        matchedJobId: job?.jobId ?? null,
        matchedVia: via,
        driverName,
        employeeId: employee?.id ?? null,
        employeeName: employee?.display_name ?? null,
      };
    });
    return {
      rows,
      employees: employees.map((e) => ({ id: e.id, name: e.display_name, status: e.status })),
      totals: {
        unattributed: rows.length,
        matched: rows.filter((r) => r.employeeId).length,
        jobFoundNoEmployee: rows.filter((r) => r.driverName && !r.employeeId).length,
        noJob: rows.filter((r) => !r.driverName).length,
      },
    };
  });

type RatingForMatch = {
  created_at: string | Date; external_job_id: string | null;
  customer_phone: string | null; ctx_phone: string | null;
  customer_email: string | null; ctx_email: string | null;
  customer_name: string | null; ctx_name: string | null;
};
type Via = "job" | "phone" | "email" | "name";

/** Same job matching as the attribution preview: job id, then phone, email, name (nearest date). */
export function buildJobMatcher(allJobs: DispatchJob[]) {
  const byJobId = new Map<string, DispatchJob[]>();
  const byPhone = new Map<string, DispatchJob[]>();
  const byEmail = new Map<string, DispatchJob[]>();
  const byName = new Map<string, DispatchJob[]>();
  const push = (m: Map<string, DispatchJob[]>, k: string | null | undefined, j: DispatchJob) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    list.push(j);
    m.set(k, list);
  };
  for (const j of allJobs) {
    push(byJobId, j.jobId ? j.jobId.replace(/^#/, "").trim() : null, j);
    const p = j.customerPhone ? last10(j.customerPhone) : "";
    push(byPhone, p.length >= 7 ? p : null, j);
    push(byEmail, j.customerEmail ? normText(j.customerEmail) : null, j);
    push(byName, j.customerName ? normText(j.customerName) : null, j);
  }
  const nearest = (cands: DispatchJob[] | undefined, ratedAt: Date) => {
    if (!cands?.length) return null;
    let best: { job: DispatchJob; gap: number } | null = null;
    for (const job of cands) {
      const t = job.completedAt ? Date.parse(job.completedAt) : NaN;
      const gap = Number.isNaN(t) ? 10 * DAY : ratedAt.getTime() - t;
      if (gap < -DAY || gap > 21 * DAY) continue;
      if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { job, gap };
    }
    return best?.job ?? (cands.length === 1 ? cands[0] : null);
  };
  return (r: RatingForMatch): { job: DispatchJob; via: Via } | null => {
    const ratedAt = new Date(r.created_at);
    const jobId = r.external_job_id ? String(r.external_job_id).replace(/^#/, "").trim() : null;
    for (const k of jobId ? [jobId, jobId.split(/[-_ ]/)[0]] : []) {
      const j = nearest(byJobId.get(k), ratedAt);
      if (j) return { job: j, via: "job" };
    }
    const phone = last10(r.customer_phone ?? r.ctx_phone ?? "");
    if (phone.length >= 7) { const j = nearest(byPhone.get(phone), ratedAt); if (j) return { job: j, via: "phone" }; }
    const email = normText(r.customer_email ?? r.ctx_email ?? "");
    if (email) { const j = nearest(byEmail.get(email), ratedAt); if (j) return { job: j, via: "email" }; }
    const name = normText(r.customer_name ?? r.ctx_name ?? "");
    if (name) { const j = nearest(byName.get(name), ratedAt); if (j) return { job: j, via: "name" }; }
    return null;
  };
}

/** Tag every company rating (attributed or not) with its job's pickup city and service. */
export const applyJobDetails = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid(), jobs: z.array(jobSchema).max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const ratings = await database`
      SELECT r.id, r.created_at, r.customer_name, r.customer_phone, r.customer_email,
             rc.external_job_id, rc.customer_name AS ctx_name, rc.customer_phone AS ctx_phone, rc.customer_email AS ctx_email
      FROM ratings r LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
      WHERE r.company_id = ${data.companyId}`;
    const match = buildJobMatcher(data.jobs);
    let tagged = 0, verified = 0, unmatched = 0;
    await database.begin(async (tx) => {
      for (const r of ratings as unknown as Array<RatingForMatch & { id: string }>) {
        const m = match(r);
        if (!m) { unmatched++; continue; }
        await tx`
          UPDATE ratings SET job_city = ${m.job.city ?? null}, job_service = ${m.job.service ?? null},
                 dispatch_job_id = ${m.job.jobId ?? null}, dispatch_match = ${m.via}
          WHERE id = ${r.id} AND company_id = ${data.companyId}`;
        tagged++;
        if (m.via !== "name") verified++;
      }
    });
    return { ok: true, tagged, verified, unmatched, total: ratings.length };
  });

export const applyRatingAttribution = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      assignments: z.array(z.object({ ratingId: z.string().uuid(), employeeId: z.string().uuid() })).min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context.userId, data.companyId);
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const employeeIds = [...new Set(data.assignments.map((a) => a.employeeId))];
    const valid = await database`SELECT id FROM drivers WHERE company_id = ${data.companyId} AND id IN ${database(employeeIds)}`;
    const validIds = new Set(valid.map((v: any) => v.id));
    for (const a of data.assignments) if (!validIds.has(a.employeeId)) throw new Error("Employee does not belong to this company");

    let updated = 0;
    await database.begin(async (tx) => {
      for (const a of data.assignments) {
        const res = await tx`
          UPDATE ratings SET driver_id = ${a.employeeId}
          WHERE id = ${a.ratingId} AND company_id = ${data.companyId} AND driver_id IS NULL`;
        updated += res.count;
        await tx`UPDATE review_contexts SET driver_id = ${a.employeeId} WHERE rating_id = ${a.ratingId} AND driver_id IS NULL`;
      }
    });
    return { ok: true, updated };
  });
