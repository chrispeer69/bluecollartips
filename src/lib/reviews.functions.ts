import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

const MAX_REVIEWS = 2000;

export type ReviewReportRow = {
  id: string;
  stars: number;
  feedback: string | null;
  customer_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  created_at: string;
};

export type ReviewReportSummary = {
  count: number;
  avg: number;
  positive: number;
  withFeedback: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

export function summarizeReviews(rows: Pick<ReviewReportRow, "stars" | "feedback">[], threshold: number): ReviewReportSummary {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewReportSummary["distribution"];
  let sum = 0, positive = 0, withFeedback = 0;
  for (const r of rows) {
    const s = Math.min(5, Math.max(1, r.stars)) as 1 | 2 | 3 | 4 | 5;
    distribution[s] += 1;
    sum += r.stars;
    if (r.stars >= threshold) positive += 1;
    if (r.feedback?.trim()) withFeedback += 1;
  }
  return { count: rows.length, avg: rows.length ? sum / rows.length : 0, positive, withFeedback, distribution };
}

/**
 * Reviews for a company (or one employee) over a date range, shaped for the
 * printable review report: handouts for employees, performance reviews, etc.
 * Company admins and super admins can pull any employee; an employee can pull
 * only their own.
 */
export const getReviewReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      driverId: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      minStars: z.number().int().min(1).max(5).optional(),
      feedbackOnly: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db, sql } = await import("@/db/client.server");
    const { data: roles } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", context.userId);
    const isAdmin = roles?.some(
      (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === data.companyId),
    ) ?? false;
    if (!isAdmin) {
      if (!data.driverId) throw new Error("Forbidden");
      const { data: own } = await db
        .from("drivers")
        .select("id")
        .eq("id", data.driverId)
        .eq("company_id", data.companyId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!own) throw new Error("Forbidden");
    }

    const { data: company } = await db
      .from("companies")
      .select("id, name, slug, logo_url, primary_color, secondary_color, positive_rating_threshold")
      .eq("id", data.companyId)
      .maybeSingle();
    if (!company) throw new Error("Not found");

    let driver: { id: string; display_name: string; employee_id: string | null; location_id: string | null } | null = null;
    if (data.driverId) {
      const { data: d } = await db
        .from("drivers")
        .select("id, display_name, employee_id, location_id")
        .eq("id", data.driverId)
        .eq("company_id", data.companyId)
        .maybeSingle();
      if (!d) throw new Error("Not found");
      driver = d;
    }

    const rows = (await sql()`
      SELECT r.id, r.stars, r.feedback, r.customer_name, r.driver_id, r.created_at,
             d.display_name AS driver_name
      FROM ratings r
      LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE r.company_id = ${data.companyId}
        AND (${data.driverId ?? null}::uuid IS NULL OR r.driver_id = ${data.driverId ?? null}::uuid)
        AND (${data.from ?? null}::timestamptz IS NULL OR r.created_at >= ${data.from ?? null}::timestamptz)
        AND (${data.to ?? null}::timestamptz IS NULL OR r.created_at <= ${data.to ?? null}::timestamptz)
        AND (${data.minStars ?? null}::int IS NULL OR r.stars >= ${data.minStars ?? null}::int)
        AND (${data.feedbackOnly ? true : false} = false OR NULLIF(BTRIM(r.feedback), '') IS NOT NULL)
      ORDER BY r.created_at DESC
      LIMIT ${MAX_REVIEWS}
    `) as unknown as ReviewReportRow[];

    const threshold = company.positive_rating_threshold ?? 4;
    const reviews = rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));

    // Group by employee for the company-wide report. Unattributed reviews land
    // in a trailing "company" group so nothing silently disappears.
    const groupMap = new Map<string | null, ReviewReportRow[]>();
    for (const r of reviews) {
      const key = r.driver_id ?? null;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(r);
    }
    const byEmployee = [...groupMap.entries()]
      .map(([driverId, list]) => ({
        driverId,
        driverName: driverId ? (list[0].driver_name ?? "Employee") : null,
        summary: summarizeReviews(list, threshold),
        reviews: list,
      }))
      .sort((a, b) => {
        if (a.driverId === null) return 1;
        if (b.driverId === null) return -1;
        return (a.driverName ?? "").localeCompare(b.driverName ?? "");
      });

    return {
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        logo_url: company.logo_url ?? null,
        primary_color: company.primary_color ?? null,
        secondary_color: company.secondary_color ?? null,
        positive_rating_threshold: threshold,
      },
      driver,
      range: { from: data.from ?? null, to: data.to ?? null },
      filters: { minStars: data.minStars ?? null, feedbackOnly: Boolean(data.feedbackOnly) },
      summary: summarizeReviews(reviews, threshold),
      reviews,
      byEmployee,
      truncated: reviews.length >= MAX_REVIEWS,
    };
  });
