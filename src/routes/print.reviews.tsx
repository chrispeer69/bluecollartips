import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getReviewReport, type ReviewReportRow, type ReviewReportSummary } from "@/lib/reviews.functions";

const bool = z.preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean());

const searchSchema = z.object({
  companyId: z.string().uuid(),
  driverId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minStars: z.coerce.number().int().min(1).max(5).optional(),
  feedbackOnly: bool.default(false),
  // Company-wide report: start each employee on a fresh page so the sheets can
  // be split up and handed out.
  perEmployee: bool.default(false),
  // Add manager/employee signature lines for performance-review handouts.
  signoff: bool.default(false),
  // Hide customer names (e.g. when posting the sheet on a break-room wall).
  anonymize: bool.default(false),
  autoprint: bool.default(true),
});

export const Route = createFileRoute("/print/reviews")({
  head: () => ({
    meta: [
      { title: "Review report — Blue Collar Tips" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: PrintReviewsPage,
});

type Report = Awaited<ReturnType<typeof getReviewReport>>;

function PrintReviewsPage() {
  const search = useSearch({ from: "/print/reviews" });
  const fetchReport = useServerFn(getReviewReport);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchReport({
          data: {
            companyId: search.companyId,
            driverId: search.driverId,
            from: search.from,
            to: search.to,
            minStars: search.minStars,
            feedbackOnly: search.feedbackOnly,
          },
        });
        if (cancelled) return;
        setReport(r);
        if (search.autoprint) setTimeout(() => window.print(), 400);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load reviews.");
      }
    })();
    return () => { cancelled = true; };
  }, [fetchReport, search.companyId, search.driverId, search.from, search.to, search.minStars, search.feedbackOnly, search.autoprint]);

  if (error) {
    return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-red-700">{error}</div>;
  }
  if (!report) {
    return <div className="grid min-h-screen place-items-center">Preparing review report…</div>;
  }

  const co = report.company;
  const brand = co.primary_color || "#0b2545";
  const accent = co.secondary_color || "#f59e0b";
  const rangeLabel = formatRange(report.range.from, report.range.to);
  const filterBits = [
    report.filters.minStars ? `${report.filters.minStars}★ and up` : null,
    report.filters.feedbackOnly ? "written feedback only" : null,
  ].filter(Boolean);
  const subtitle = [rangeLabel, ...filterBits].join(" · ");
  const title = report.driver ? `Customer reviews — ${report.driver.display_name}` : "Customer reviews — all employees";

  return (
    <div className="min-h-screen bg-white p-10 text-black print:p-0" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @media print {
          @page { size: letter; margin: 0.6in; }
          .no-print { display: none !important; }
          .page-break { break-before: page; page-break-before: always; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mx-auto mb-6 flex max-w-[7.5in] flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
        <span className="text-gray-600">
          {report.summary.count} review{report.summary.count === 1 ? "" : "s"} loaded.
          {report.truncated ? " Showing the most recent 2,000 — narrow the date range to see everything." : ""}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="rounded-md px-3 py-1.5 text-white" style={{ background: brand }}>Print / Save as PDF</button>
          <button type="button" onClick={() => window.close()} className="rounded-md border border-gray-300 bg-white px-3 py-1.5">Close</button>
        </div>
      </div>

      <div className="mx-auto max-w-[7.5in]">
        <ReportHeader company={co} brand={brand} title={title} subtitle={subtitle} employeeId={report.driver?.employee_id ?? null} />

        {report.summary.count === 0 ? (
          <div className="mt-10 text-center text-sm text-gray-500">No reviews match this range.</div>
        ) : report.driver ? (
          <>
            <SummaryBlock summary={report.summary} threshold={co.positive_rating_threshold} brand={brand} accent={accent} />
            <ReviewList reviews={report.reviews} accent={accent} anonymize={search.anonymize} />
            {search.signoff && <SignOff brand={brand} />}
          </>
        ) : (
          <>
            <SummaryBlock summary={report.summary} threshold={co.positive_rating_threshold} brand={brand} accent={accent} />
            <EmployeeTable groups={report.byEmployee} companyName={co.name} threshold={co.positive_rating_threshold} accent={accent} />
            {report.byEmployee.map((g) => (
              <section key={g.driverId ?? "company"} className={`mt-10 ${search.perEmployee ? "page-break" : ""}`}>
                {search.perEmployee ? (
                  <ReportHeader
                    company={co}
                    brand={brand}
                    title={`Customer reviews — ${g.driverName ?? `${co.name} (not attributed to an employee)`}`}
                    subtitle={subtitle}
                    employeeId={null}
                  />
                ) : (
                  <h2 className="border-b pb-1 text-lg font-bold" style={{ borderColor: brand, color: brand }}>
                    {g.driverName ?? `${co.name} — not attributed to an employee`}
                  </h2>
                )}
                <SummaryBlock summary={g.summary} threshold={co.positive_rating_threshold} brand={brand} accent={accent} compact={!search.perEmployee} />
                <ReviewList reviews={g.reviews} accent={accent} anonymize={search.anonymize} />
                {search.signoff && search.perEmployee && g.driverId && <SignOff brand={brand} />}
              </section>
            ))}
            {search.signoff && !search.perEmployee && <SignOff brand={brand} />}
          </>
        )}

        <div className="mt-10 flex items-center justify-between border-t pt-3 text-[10px] text-gray-500">
          <span>Generated by Blue Collar Tips · {new Date().toLocaleString()}</span>
          <span>{co.name}</span>
        </div>
      </div>
    </div>
  );
}

function ReportHeader({ company, brand, title, subtitle, employeeId }: {
  company: Report["company"];
  brand: string;
  title: string;
  subtitle: string;
  employeeId: string | null;
}) {
  return (
    <div className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: brand }}>
      <div>
        <div className="text-xs uppercase tracking-widest text-gray-500">{company.name}</div>
        <h1 className="mt-1 text-2xl font-bold" style={{ color: brand }}>{title}</h1>
        <div className="mt-1 text-xs text-gray-600">{subtitle}</div>
        {employeeId && <div className="mt-1 text-xs text-gray-500">Employee ID: {employeeId}</div>}
      </div>
      {company.logo_url && <img src={company.logo_url} alt="" className="h-14 max-w-[2.5in] object-contain" />}
    </div>
  );
}

function SummaryBlock({ summary, threshold, brand, accent, compact = false }: {
  summary: ReviewReportSummary;
  threshold: number;
  brand: string;
  accent: string;
  compact?: boolean;
}) {
  const pct = summary.count ? Math.round((summary.positive / summary.count) * 100) : 0;
  const max = Math.max(1, ...Object.values(summary.distribution));
  return (
    <div className={`avoid-break ${compact ? "mt-3" : "mt-6"} grid gap-4 sm:grid-cols-[1fr_1.2fr]`}>
      <div className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-2"} text-center`}>
        <Cell label="Reviews" v={String(summary.count)} compact={compact} />
        <Cell label="Average" v={summary.count ? summary.avg.toFixed(2) : "—"} suffix="★" compact={compact} color={accent} />
        <Cell label={`${threshold}★ and up`} v={`${pct}%`} compact={compact} color={brand} />
        <Cell label="With comments" v={String(summary.withFeedback)} compact={compact} />
      </div>
      <div className="rounded-md border p-3">
        {([5, 4, 3, 2, 1] as const).map((s) => (
          <div key={s} className="flex items-center gap-2 py-0.5 text-xs">
            <span className="w-6 text-right tabular-nums">{s}★</span>
            <div className="h-2.5 flex-1 rounded bg-gray-100">
              <div className="h-2.5 rounded" style={{ width: `${(summary.distribution[s] / max) * 100}%`, background: s >= threshold ? accent : "#9ca3af" }} />
            </div>
            <span className="w-8 text-right tabular-nums text-gray-600">{summary.distribution[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeTable({ groups, companyName, threshold, accent }: {
  groups: Report["byEmployee"];
  companyName: string;
  threshold: number;
  accent: string;
}) {
  const ranked = [...groups].sort((a, b) => {
    if (a.driverId === null) return 1;
    if (b.driverId === null) return -1;
    return b.summary.avg - a.summary.avg || b.summary.count - a.summary.count;
  });
  return (
    <table className="avoid-break mt-6 w-full border-collapse text-xs">
      <thead>
        <tr className="border-b bg-gray-50 text-left">
          <th className="p-2">Employee</th>
          <th className="p-2 text-right">Reviews</th>
          <th className="p-2 text-right">Average</th>
          <th className="p-2 text-right">{threshold}★ and up</th>
          <th className="p-2 text-right">5★</th>
          <th className="p-2 text-right">Comments</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((g) => (
          <tr key={g.driverId ?? "company"} className="border-b">
            <td className="p-2 font-medium">{g.driverName ?? <span className="text-gray-500">{companyName} (not attributed)</span>}</td>
            <td className="p-2 text-right tabular-nums">{g.summary.count}</td>
            <td className="p-2 text-right tabular-nums" style={{ color: accent }}>{g.summary.avg.toFixed(2)}</td>
            <td className="p-2 text-right tabular-nums">{g.summary.count ? Math.round((g.summary.positive / g.summary.count) * 100) : 0}%</td>
            <td className="p-2 text-right tabular-nums">{g.summary.distribution[5]}</td>
            <td className="p-2 text-right tabular-nums">{g.summary.withFeedback}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewList({ reviews, accent, anonymize }: { reviews: ReviewReportRow[]; accent: string; anonymize: boolean }) {
  return (
    <ul className="mt-4 divide-y divide-gray-200">
      {reviews.map((r) => (
        <li key={r.id} className="avoid-break py-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <span style={{ color: accent }}>{"★".repeat(r.stars)}</span>
              <span className="text-gray-300">{"★".repeat(5 - r.stars)}</span>
              {!anonymize && r.customer_name && <span className="ml-2 text-xs text-gray-600">— {r.customer_name}</span>}
            </div>
            <span className="shrink-0 text-xs text-gray-500">
              {new Date(r.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
          {r.feedback?.trim() ? (
            <p className="mt-1 whitespace-pre-wrap leading-snug">{r.feedback.trim()}</p>
          ) : (
            <p className="mt-0.5 text-xs italic text-gray-400">Rating only — no written comment.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function SignOff({ brand }: { brand: string }) {
  return (
    <div className="avoid-break mt-10 border-t pt-4 text-xs text-gray-700" style={{ borderColor: brand }}>
      <div className="mb-2 font-semibold uppercase tracking-wider text-gray-500">Manager notes</div>
      <div className="mb-8 h-20 rounded border border-dashed border-gray-300" />
      <div className="grid grid-cols-2 gap-10">
        <div>
          <div className="border-b border-gray-500 pb-8" />
          <div className="mt-1">Employee signature / date</div>
        </div>
        <div>
          <div className="border-b border-gray-500 pb-8" />
          <div className="mt-1">Manager signature / date</div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, v, suffix, compact, color }: { label: string; v: string; suffix?: string; compact?: boolean; color?: string }) {
  return (
    <div className={`rounded-md border ${compact ? "p-2" : "p-3"}`}>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`mt-1 font-semibold ${compact ? "text-base" : "text-2xl"}`} style={color ? { color } : undefined}>
        {v}{suffix && <span className="ml-0.5 text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

function formatRange(from: string | null, to: string | null) {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `Since ${fmt(from)}`;
  if (to) return `Through ${fmt(to)}`;
  return "All time";
}
