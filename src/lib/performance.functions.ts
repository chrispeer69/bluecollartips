import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

// Employee performance report built from the `ratings` table. Each period is
// compared against the period immediately before it so admins can see who is
// trending up or down, not just who has the highest average.

export const PERIODS = {
  week: { days: 7, label: "Last 7 days", priorLabel: "the 7 days before" },
  month: { days: 30, label: "Last 30 days", priorLabel: "the 30 days before" },
  quarter: { days: 90, label: "Last 90 days", priorLabel: "the 90 days before" },
} as const;
export type Period = keyof typeof PERIODS;

export type Trend = "up" | "down" | "steady" | "new" | "quiet";

// Minimum reviews in the current window before we call a trend. One or two
// reviews swing an average too much to reward or worry about.
const MIN_REVIEWS_FOR_TREND = 3;
// Average must move at least this much (in stars) to count as a trend.
const TREND_THRESHOLD = 0.25;
// Ranking uses a shrunk average: a driver with one 5★ review shouldn't outrank
// someone holding 4.9 over 20 reviews. Each driver's average is pulled toward
// the company average by this many "phantom" reviews.
const RANK_PRIOR_WEIGHT = 3;

type Bucket = {
  n: number;
  sum: number;
  five: number;
  low: number; // 1–2 stars
  flagged: number;
  dist: [number, number, number, number, number]; // index 0 = 1★
};

function emptyBucket(): Bucket {
  return { n: 0, sum: 0, five: 0, low: 0, flagged: 0, dist: [0, 0, 0, 0, 0] };
}

function add(b: Bucket, stars: number, flagged: boolean) {
  b.n += 1;
  b.sum += stars;
  if (stars === 5) b.five += 1;
  if (stars <= 2) b.low += 1;
  if (flagged) b.flagged += 1;
  b.dist[stars - 1] += 1;
}

function summarize(b: Bucket) {
  return {
    n: b.n,
    avg: b.n ? b.sum / b.n : null,
    five: b.five,
    fiveStarPct: b.n ? (b.five / b.n) * 100 : null,
    low: b.low,
    flagged: b.flagged,
    dist: b.dist,
  };
}

function classify(current: Bucket, prior: Bucket): { trend: Trend; delta: number | null } {
  if (current.n === 0) return { trend: "quiet", delta: null };
  if (prior.n === 0) return { trend: "new", delta: null };
  const delta = current.sum / current.n - prior.sum / prior.n;
  if (current.n < MIN_REVIEWS_FOR_TREND) return { trend: "steady", delta };
  if (delta >= TREND_THRESHOLD) return { trend: "up", delta };
  if (delta <= -TREND_THRESHOLD) return { trend: "down", delta };
  return { trend: "steady", delta };
}

async function assertCompanyAdmin(userId: string, companyId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db.from("user_roles").select("role, company_id").eq("user_id", userId);
  const ok = data?.some(
    (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === companyId),
  ) ?? false;
  if (!ok) throw new Error("Forbidden");
}

export const getDriverPerformance = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      period: z.enum(["week", "month", "quarter"]).default("month"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db, sql } = await import("@/db/client.server");

    const { days } = PERIODS[data.period];
    const now = new Date();
    const currentStart = new Date(now.getTime() - days * 86_400_000);
    const priorStart = new Date(currentStart.getTime() - days * 86_400_000);

    const [{ data: drivers }, rows] = await Promise.all([
      db
        .from("drivers")
        .select("id, display_name, status, photo_url")
        .eq("company_id", data.companyId),
      sql()`
        SELECT driver_id, stars, flagged, feedback, customer_name, created_at
        FROM ratings
        WHERE company_id = ${data.companyId}
          AND created_at >= ${priorStart.toISOString()}
        ORDER BY created_at DESC
      ` as unknown as Promise<Array<{
        driver_id: string | null;
        stars: number;
        flagged: boolean;
        feedback: string | null;
        customer_name: string | null;
        created_at: Date | string;
      }>>,
    ]);

    const perDriver = new Map<string, { current: Bucket; prior: Bucket; comments: Array<{ stars: number; feedback: string; customer_name: string | null; created_at: string }> }>();
    for (const d of drivers ?? []) perDriver.set(d.id, { current: emptyBucket(), prior: emptyBucket(), comments: [] });
    const company = { current: emptyBucket(), prior: emptyBucket() };
    let unattributed = 0;

    for (const r of rows) {
      const at = new Date(r.created_at);
      const isCurrent = at >= currentStart;
      add(isCurrent ? company.current : company.prior, r.stars, r.flagged);
      if (!r.driver_id) {
        if (isCurrent) unattributed += 1;
        continue;
      }
      // A rating for a driver that's since been deleted cascades away, but be
      // defensive about ids we didn't load.
      const entry = perDriver.get(r.driver_id);
      if (!entry) continue;
      add(isCurrent ? entry.current : entry.prior, r.stars, r.flagged);
      if (isCurrent && r.feedback && entry.comments.length < 3) {
        entry.comments.push({
          stars: r.stars,
          feedback: r.feedback,
          customer_name: r.customer_name,
          created_at: at.toISOString(),
        });
      }
    }

    const companyAvg = company.current.n ? company.current.sum / company.current.n : 4.5;
    const result = (drivers ?? []).map((d) => {
      const entry = perDriver.get(d.id)!;
      const { trend, delta } = classify(entry.current, entry.prior);
      const score = (entry.current.sum + RANK_PRIOR_WEIGHT * companyAvg) / (entry.current.n + RANK_PRIOR_WEIGHT);
      return {
        driverId: d.id,
        name: d.display_name,
        status: d.status as "pending" | "active" | "deactivated",
        photoUrl: d.photo_url as string | null,
        current: summarize(entry.current),
        prior: summarize(entry.prior),
        delta,
        trend,
        score,
        comments: entry.comments,
      };
    });

    // Leaderboard: anyone with reviews this period, best first. Drivers with
    // no reviews sink to the bottom so the report never rewards silence.
    result.sort((a, b) => {
      if (a.current.n === 0 && b.current.n === 0) return a.name.localeCompare(b.name);
      if (a.current.n === 0) return 1;
      if (b.current.n === 0) return -1;
      return b.score - a.score || b.current.n - a.current.n || a.name.localeCompare(b.name);
    });

    const companyTrend = classify(company.current, company.prior);
    return {
      period: data.period,
      days,
      currentStart: currentStart.toISOString(),
      priorStart: priorStart.toISOString(),
      generatedAt: now.toISOString(),
      company: {
        current: summarize(company.current),
        prior: summarize(company.prior),
        delta: companyTrend.delta,
        trend: companyTrend.trend,
        unattributed,
      },
      drivers: result,
    };
  });

export type PerformanceReport = Awaited<ReturnType<typeof getDriverPerformance>>;
export type DriverPerformance = PerformanceReport["drivers"][number];
