import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Minus, Sparkles, Trophy } from "lucide-react";
import {
  getDriverPerformance,
  PERIODS,
  type DriverPerformance,
  type Period,
  type PerformanceReport,
  type Trend,
} from "@/lib/performance.functions";

// Employee performance report: who's earning the best reviews this period and
// who's moving up or down compared with the period before.

const TREND: Record<Trend, { label: string; className: string; Icon: typeof ArrowUp }> = {
  up: { label: "Up", className: "text-emerald-700", Icon: ArrowUp },
  down: { label: "Down", className: "text-destructive", Icon: ArrowDown },
  steady: { label: "Steady", className: "text-muted-foreground", Icon: ArrowRight },
  new: { label: "New", className: "text-primary", Icon: Sparkles },
  quiet: { label: "No reviews", className: "text-muted-foreground", Icon: Minus },
};

function fmtAvg(avg: number | null) {
  return avg == null ? "—" : avg.toFixed(2);
}

function fmtDelta(delta: number | null, unit = "") {
  if (delta == null) return null;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${Math.abs(delta).toFixed(unit === "%" ? 0 : 2)}${unit}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Big arrow first, then the label and the change in average vs the prior
// period, so direction reads at a glance and never by color alone.
function TrendArrow({ trend, delta, size = "md" }: { trend: Trend; delta: number | null; size?: "md" | "lg" }) {
  const { label, className, Icon } = TREND[trend];
  const showDelta = (trend === "up" || trend === "down" || trend === "steady") && delta != null && Math.abs(delta) >= 0.005;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${className}`}>
      <Icon size={size === "lg" ? 28 : 22} strokeWidth={2.75} aria-hidden />
      <span className="text-sm">
        {label}
        {showDelta && <span className="ml-1 font-normal tabular-nums">{fmtDelta(delta)}★</span>}
      </span>
    </span>
  );
}

function StatTile({
  label,
  value,
  delta,
  deltaGoodWhen = "up",
  hint,
}: {
  label: string;
  value: string;
  delta?: string | null;
  deltaGoodWhen?: "up" | "down";
  hint: string;
}) {
  const positive = delta?.startsWith("+");
  const negative = delta?.startsWith("−");
  const good = (positive && deltaGoodWhen === "up") || (negative && deltaGoodWhen === "down");
  const bad = (negative && deltaGoodWhen === "up") || (positive && deltaGoodWhen === "down");
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {delta ? (
          <span className={good ? "text-emerald-700" : bad ? "text-destructive" : ""}>{delta}</span>
        ) : (
          <span>—</span>
        )}{" "}
        vs {hint}
      </div>
    </div>
  );
}

function Stars({ avg }: { avg: number | null }) {
  const full = avg == null ? 0 : Math.round(avg);
  return (
    <span aria-hidden className="text-sm leading-none">
      <span className="text-secondary">{"★".repeat(full)}</span>
      <span className="text-muted-foreground/50">{"★".repeat(5 - full)}</span>
    </span>
  );
}

// Single-hue meter: share of this driver's reviews that were 5★.
function FiveStarMeter({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-primary/15" role="img" aria-label={`${Math.round(pct)}% five-star`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

function PodiumCard({ rank, driver, priorLabel }: { rank: number; driver: DriverPerformance; priorLabel: string }) {
  const comment = driver.comments[0];
  return (
    <div className={`rounded-xl border p-4 ${rank === 1 ? "border-secondary bg-secondary/5" : "border-border bg-card"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Trophy size={14} className={rank === 1 ? "text-secondary" : ""} aria-hidden />
            #{rank}
          </div>
          <div className="mt-1 truncate text-lg font-semibold">{driver.name}</div>
        </div>
        <TrendArrow trend={driver.trend} delta={driver.delta} size="lg" />
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums">{driver.current.points} <span className="text-sm font-normal text-muted-foreground">pts</span></span>
        <span className="text-base font-semibold tabular-nums">{fmtAvg(driver.current.avg)}</span>
        <Stars avg={driver.current.avg} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {driver.current.n} review{driver.current.n === 1 ? "" : "s"} · {driver.current.five} five-star
        {driver.prior.avg != null && <> · {fmtAvg(driver.prior.avg)}★ {priorLabel}</>}
      </div>
      {comment && (
        <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm">
          <p className="line-clamp-3">“{comment.feedback}”</p>
          {comment.customer_name && <footer className="mt-1 text-xs text-muted-foreground">— {comment.customer_name}</footer>}
        </blockquote>
      )}
    </div>
  );
}

function MoverList({ title, drivers, empty, direction }: { title: string; drivers: DriverPerformance[]; empty: string; direction: "up" | "down" }) {
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  const tone = direction === "up" ? "text-emerald-700" : "text-destructive";
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${tone}`}>
        <Icon size={16} aria-hidden /> {title}
      </h3>
      {drivers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {drivers.map((d) => (
            <li key={d.driverId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtAvg(d.prior.avg)} → {fmtAvg(d.current.avg)} · {d.current.n} review{d.current.n === 1 ? "" : "s"}
                  {d.current.low > 0 && <> · {d.current.low} low</>}
                </div>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums ${tone}`}><Icon size={18} strokeWidth={2.75} aria-hidden />{fmtDelta(d.delta)}★</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PerformancePanel({ companyId, onGoToFeedback }: { companyId: string; onGoToFeedback?: () => void }) {
  const fetchReport = useServerFn(getDriverPerformance);
  const [period, setPeriod] = useState<Period>("week");
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReport({ data: { companyId, period } })
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the report."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, period]);

  const meta = PERIODS[period];
  const c = report?.company;
  const rated = report?.drivers.filter((d) => d.current.n > 0) ?? [];
  const podium = rated.slice(0, 3);
  const up = report?.drivers.filter((d) => d.trend === "up").sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)) ?? [];
  const down = report?.drivers.filter((d) => d.trend === "down").sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)) ?? [];
  const reviewsDelta = c ? c.current.n - c.prior.n : null;
  const fivePctDelta = c && c.current.fiveStarPct != null && c.prior.fiveStarPct != null ? c.current.fiveStarPct - c.prior.fiveStarPct : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Report period">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-sm ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {PERIODS[p].label}
            </button>
          ))}
        </div>
        {report && (
          <div className="text-xs text-muted-foreground">
            {fmtDate(report.currentStart)} – {fmtDate(report.generatedAt)}, compared with {meta.priorLabel}
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      {loading && !report && <div className="text-sm text-muted-foreground">Crunching reviews…</div>}

      {report && c && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Reviews" value={String(c.current.n)} delta={fmtDelta(reviewsDelta)?.replace(/\.00$/, "") ?? null} hint={meta.priorLabel} />
            <StatTile label="Average rating" value={c.current.avg == null ? "—" : `${fmtAvg(c.current.avg)} ★`} delta={fmtDelta(c.delta)} hint={meta.priorLabel} />
            <StatTile label="Five-star share" value={c.current.fiveStarPct == null ? "—" : `${Math.round(c.current.fiveStarPct)}%`} delta={fmtDelta(fivePctDelta, "%")} hint={meta.priorLabel} />
            <StatTile label="Low ratings (1–2★)" value={String(c.current.low)} delta={fmtDelta(c.current.low - c.prior.low)?.replace(/\.00$/, "") ?? null} deltaGoodWhen="down" hint={meta.priorLabel} />
          </div>

          {c.unattributed > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <span>
                <span className="font-medium">{c.unattributed} review{c.unattributed === 1 ? "" : "s"}</span> this period {c.unattributed === 1 ? "isn't" : "aren't"} assigned to an employee, so {c.unattributed === 1 ? "it doesn't" : "they don't"} count toward anyone below.
              </span>
              {onGoToFeedback && (
                <button type="button" onClick={onGoToFeedback} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs">
                  Assign in Ratings & feedback
                </button>
              )}
            </div>
          )}

          {rated.length === 0 ? (
            <div className="mt-4 rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No employee reviews in the {meta.label.toLowerCase()}. Try a longer period.
            </div>
          ) : (
            <>
              <section className="mt-6">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top performers</h2>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  {podium.map((d, i) => <PodiumCard key={d.driverId} rank={i + 1} driver={d} priorLabel={meta.priorLabel} />)}
                </div>
              </section>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <MoverList title="Trending up" direction="up" drivers={up} empty="Nobody's average rose by 0.25★ or more this period (needs at least 3 reviews)." />
                <MoverList title="Trending down" direction="down" drivers={down} empty="Nobody's average dropped by 0.25★ or more this period." />
              </div>

              <section className="mt-6 rounded-xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Leaderboard · {meta.label.toLowerCase()}</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Rank</th>
                        <th className="py-2 pr-3 font-medium">Employee</th>
                        <th className="py-2 pr-3 text-right font-medium">Score</th>
                        <th className="py-2 pr-3 text-right font-medium">Reviews</th>
                        <th className="py-2 pr-3 text-right font-medium">Avg ★</th>
                        <th className="py-2 pr-3 font-medium">Five-star</th>
                        <th className="py-2 pr-3 text-right font-medium">Low</th>
                        <th className="py-2 pr-3 text-right font-medium">Prior avg ★</th>
                        <th className="py-2 font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.drivers.map((d, i) => {
                        const quiet = d.current.n === 0;
                        return (
                          <tr key={d.driverId} className={quiet ? "text-muted-foreground" : i === 0 ? "bg-secondary/5" : ""}>
                            <td className="py-2.5 pr-3 text-lg font-bold tabular-nums">
                              {quiet ? "—" : i === 0 ? <span className="inline-flex items-center gap-1"><Trophy size={18} className="text-secondary" aria-hidden />1</span> : i + 1}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="font-medium">{d.name}</span>
                              {d.status !== "active" && <span className="ml-2 text-xs text-muted-foreground">({d.status})</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-base font-bold tabular-nums">{quiet ? "—" : d.current.points}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">{d.current.n}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">{fmtAvg(d.current.avg)}</td>
                            <td className="py-2.5 pr-3"><FiveStarMeter pct={d.current.fiveStarPct} /></td>
                            <td className={`py-2.5 pr-3 text-right tabular-nums ${d.current.low > 0 ? "font-semibold text-destructive" : ""}`}>{d.current.n ? d.current.low : "—"}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">{fmtAvg(d.prior.avg)}</td>
                            <td className="py-2.5"><TrendArrow trend={d.trend} delta={d.delta} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Score:</span> 5★ = +2 · 4★ = +1 · 3★ = 0 · 2★ = −2 · 1★ = −3 per review, so more happy customers means a higher rank and one bad job isn't erased by one good one.
                  {" "}<span className="font-medium text-foreground">Trend:</span> change in average rating vs {meta.priorLabel} (needs 3+ reviews; ±0.25★ to count as up or down). Low = 1–2★ reviews.
                </p>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
