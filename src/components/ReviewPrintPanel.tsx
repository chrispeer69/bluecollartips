import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getReviewReport } from "@/lib/reviews.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Preset = "last_week" | "this_week" | "last_30" | "last_month" | "this_month" | "last_90" | "ytd" | "all" | "custom";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "last_week", label: "Last week (Mon–Sun)" },
  { id: "this_week", label: "This week so far" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
  { id: "this_month", label: "This month so far" },
  { id: "last_90", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom dates" },
];

const ALL_EMPLOYEES = "__all__";
const ANY_STARS = "__any__";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -dow);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve a preset to local-day boundaries; `null` means unbounded. */
export function presetRange(preset: Preset, custom: { from: string; to: string }, now = new Date()): { from: Date | null; to: Date | null } {
  switch (preset) {
    case "last_week": { const mon = mondayOf(now); return { from: addDays(mon, -7), to: endOfDay(addDays(mon, -1)) }; }
    case "this_week": return { from: mondayOf(now), to: endOfDay(now) };
    case "last_30": return { from: startOfDay(addDays(now, -30)), to: endOfDay(now) };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: first, to: endOfDay(last) };
    }
    case "this_month": return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
    case "last_90": return { from: startOfDay(addDays(now, -90)), to: endOfDay(now) };
    case "ytd": return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
    case "all": return { from: null, to: null };
    case "custom": {
      const from = custom.from ? startOfDay(new Date(custom.from + "T00:00:00")) : null;
      const to = custom.to ? endOfDay(new Date(custom.to + "T00:00:00")) : null;
      return { from, to };
    }
  }
}

export function ReviewPrintPanel({
  companyId,
  drivers,
  initialDriverId = null,
}: {
  companyId: string;
  drivers: Array<{ id: string; display_name: string; status?: string }>;
  initialDriverId?: string | null;
}) {
  const fetchReport = useServerFn(getReviewReport);
  const [driverId, setDriverId] = useState<string>(initialDriverId ?? ALL_EMPLOYEES);
  const [preset, setPreset] = useState<Preset>("last_month");
  const [custom, setCustom] = useState({ from: ymd(addDays(new Date(), -30)), to: ymd(new Date()) });
  const [minStars, setMinStars] = useState<string>(ANY_STARS);
  const [feedbackOnly, setFeedbackOnly] = useState(false);
  const [perEmployee, setPerEmployee] = useState(true);
  const [signoff, setSignoff] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; avg: number; withFeedback: number; employees: number } | null>(null);

  const sorted = useMemo(() => [...drivers].sort((a, b) => a.display_name.localeCompare(b.display_name)), [drivers]);
  const range = presetRange(preset, custom);
  const allMode = driverId === ALL_EMPLOYEES;

  const params = () => {
    const q = new URLSearchParams({ companyId });
    if (!allMode) q.set("driverId", driverId);
    if (range.from) q.set("from", range.from.toISOString());
    if (range.to) q.set("to", range.to.toISOString());
    if (minStars !== ANY_STARS) q.set("minStars", minStars);
    if (feedbackOnly) q.set("feedbackOnly", "1");
    if (allMode && perEmployee) q.set("perEmployee", "1");
    if (signoff) q.set("signoff", "1");
    if (anonymize) q.set("anonymize", "1");
    return q;
  };

  const openPrint = (autoprint: boolean) => {
    const q = params();
    if (!autoprint) q.set("autoprint", "0");
    window.open(`/print/reviews?${q.toString()}`, "_blank", "noopener,noreferrer");
  };

  const check = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchReport({
        data: {
          companyId,
          driverId: allMode ? undefined : driverId,
          from: range.from?.toISOString(),
          to: range.to?.toISOString(),
          minStars: minStars === ANY_STARS ? undefined : Number(minStars),
          feedbackOnly,
        },
      });
      setPreview({
        count: r.summary.count,
        avg: r.summary.avg,
        withFeedback: r.summary.withFeedback,
        employees: r.byEmployee.filter((g) => g.driverId).length,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load reviews.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Pull an employee's customer reviews for a week, a month, or any range and print them as a handout, a
        performance-review packet, or a break-room sheet. Choose “All employees” to print the whole team with a
        page for each person.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <span className="text-xs text-muted-foreground">Employee</span>
          <Select value={driverId} onValueChange={(v) => { setDriverId(v); setPreview(null); }}>
            <SelectTrigger className="mt-1" aria-label="Employee"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_EMPLOYEES}>All employees</SelectItem>
              {sorted.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.display_name}{d.status && d.status !== "active" ? ` (${d.status})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span className="text-xs text-muted-foreground">Date range</span>
          <Select value={preset} onValueChange={(v) => { setPreset(v as Preset); setPreview(null); }}>
            <SelectTrigger className="mt-1" aria-label="Date range"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span className="text-xs text-muted-foreground">Minimum rating</span>
          <Select value={minStars} onValueChange={(v) => { setMinStars(v); setPreview(null); }}>
            <SelectTrigger className="mt-1" aria-label="Minimum rating"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_STARS}>Any rating</SelectItem>
              <SelectItem value="5">5 stars only</SelectItem>
              <SelectItem value="4">4 stars and up</SelectItem>
              <SelectItem value="3">3 stars and up</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {preset === "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="text-xs text-muted-foreground">From</span>
            <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); setPreview(null); }} className={inputCls} />
          </label>
          <label>
            <span className="text-xs text-muted-foreground">To</span>
            <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); setPreview(null); }} className={inputCls} />
          </label>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Covers {range.from ? range.from.toLocaleDateString() : "the beginning"} through {range.to ? range.to.toLocaleDateString() : "today"}.
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={feedbackOnly} onChange={(e) => { setFeedbackOnly(e.target.checked); setPreview(null); }} />
          Only reviews with a written comment
        </label>
        {allMode && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={perEmployee} onChange={(e) => setPerEmployee(e.target.checked)} />
            One page per employee (for handouts)
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
          Add manager notes &amp; signature lines
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} />
          Hide customer names
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => openPrint(true)} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Print / save as PDF
        </button>
        <button type="button" onClick={() => openPrint(false)} className="rounded-md border border-border bg-card px-4 py-2 text-sm">
          Open preview
        </button>
        <button type="button" onClick={check} disabled={busy} className="rounded-md border border-border bg-card px-4 py-2 text-sm disabled:opacity-50">
          {busy ? "Checking…" : "Check what's included"}
        </button>
        {preview && (
          <span role="status" className="text-xs text-muted-foreground">
            {preview.count} review{preview.count === 1 ? "" : "s"}
            {preview.count ? ` · ${preview.avg.toFixed(2)}★ average · ${preview.withFeedback} with comments` : ""}
            {allMode && preview.count ? ` · ${preview.employees} employee${preview.employees === 1 ? "" : "s"}` : ""}
          </span>
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
