import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getReviewReport } from "@/lib/reviews.functions";
import { ReviewPrintPanel } from "@/components/ReviewPrintPanel";

type Filter = "all" | "top" | "comments" | "low";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "top", label: "5 stars" },
  { id: "comments", label: "With comments" },
  { id: "low", label: "Needs attention" },
];

type Report = Awaited<ReturnType<typeof getReviewReport>>;

/**
 * An employee's own reviews: what customers said, in full, with the same
 * printing options their admin has but locked to themselves.
 */
export function MyReviewsPanel({
  companyId,
  driverId,
  driverName,
}: {
  companyId: string;
  driverId: string;
  driverName: string;
}) {
  const fetchReport = useServerFn(getReviewReport);
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    fetchReport({ data: { companyId, driverId } })
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load your reviews."); });
    return () => { cancelled = true; };
  }, [fetchReport, companyId, driverId]);

  const reviews = report?.reviews ?? [];
  const filtered = useMemo(() => {
    switch (filter) {
      case "top": return reviews.filter((r) => r.stars === 5);
      case "comments": return reviews.filter((r) => r.feedback?.trim());
      case "low": return reviews.filter((r) => r.stars <= 2);
      default: return reviews;
    }
  }, [reviews, filter]);

  const counts = useMemo(() => ({
    all: reviews.length,
    top: reviews.filter((r) => r.stars === 5).length,
    comments: reviews.filter((r) => r.feedback?.trim()).length,
    low: reviews.filter((r) => r.stars <= 2).length,
  }), [reviews]);

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!report) return <p className="text-sm text-muted-foreground">Loading your reviews…</p>;

  const s = report.summary;
  const threshold = report.company.positive_rating_threshold;
  const maxBar = Math.max(1, ...Object.values(s.distribution));
  const visible = showAll ? filtered : filtered.slice(0, 25);

  return (
    <div className="space-y-6">
      {s.count === 0 ? (
        <p className="text-sm text-muted-foreground">
          No reviews yet. When a customer rates you from your tip link, it shows up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Average" value={`${s.avg.toFixed(2)} ★`} emphasis />
            <Tile label="Reviews" value={String(s.count)} />
            <Tile label={`${threshold}★ and up`} value={`${Math.round((s.positive / s.count) * 100)}%`} />
            <Tile label="With comments" value={String(s.withFeedback)} />
          </div>

          <div className="rounded-xl border border-border p-4">
            {([5, 4, 3, 2, 1] as const).map((star) => (
              <div key={star} className="flex items-center gap-3 py-1 text-xs">
                <span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">{star}★</span>
                <div className="h-2.5 flex-1 rounded-full bg-muted">
                  <div
                    className={`h-2.5 rounded-full ${star >= threshold ? "bg-secondary" : "bg-muted-foreground/50"}`}
                    style={{ width: `${(s.distribution[star] / maxBar) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{s.distribution[star]}</span>
              </div>
            ))}
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter my reviews">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => { setFilter(f.id); setShowAll(false); }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  filter === f.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {f.label} ({counts[f.id]})
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this filter.</p>
          ) : (
            <ul className="space-y-3">
              {visible.map((r) => (
                <li key={r.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-base leading-none">
                      <span className="text-secondary">{"★".repeat(r.stars)}</span>
                      <span className="text-muted-foreground/40">{"★".repeat(5 - r.stars)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  {r.feedback?.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{r.feedback.trim()}</p>
                  ) : (
                    <p className="mt-2 text-xs italic text-muted-foreground">Rating only — no written comment.</p>
                  )}
                  {r.customer_name && <p className="mt-2 text-xs text-muted-foreground">— {r.customer_name}</p>}
                </li>
              ))}
            </ul>
          )}

          {!showAll && filtered.length > visible.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium"
            >
              Show all {filtered.length} reviews
            </button>
          )}
        </>
      )}

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Print my reviews</h3>
        <div className="mt-3">
          <ReviewPrintPanel
            companyId={companyId}
            drivers={[{ id: driverId, display_name: driverName }]}
            lockedDriverId={driverId}
            intro="Pick a date range and print your reviews — hand them to your manager, keep them for a review, or save a PDF to your phone."
          />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-semibold ${emphasis ? "text-2xl text-secondary" : "text-2xl"}`}>{value}</div>
    </div>
  );
}
