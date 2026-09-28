import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { assignVipFollowupCustomer, assignVipFollowupDay, getVipReport, logVipFollowupCall, saveVipFollowupStaff, setVipNextFollowup, updateVipFollowup } from "@/lib/vip.functions";
import { followupState, todayYmd, vipNextStep, type FollowupState, type VipReportRow, type VipStage } from "@/lib/vip";
import { dollars } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type VipRangePreset = "due" | "today" | "yesterday" | "last_7" | "last_30" | "custom";
export type VipStageFilter = "all" | VipStage;

const RANGES: Array<{ id: VipRangePreset; label: string }> = [
  { id: "due", label: "Follow-ups due" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "custom", label: "Pick dates" },
];

export const STAGE_FILTERS: Array<{ id: VipStageFilter; label: string }> = [
  { id: "all", label: "Everyone" },
  { id: "clicked", label: "Hot — opened Convini, not registered" },
  { id: "link_sent", label: "Got the link, hasn't opened it" },
  { id: "no_link", label: "Convini link not sent" },
  { id: "registered", label: "Registered on Convini" },
];

// Work the hottest leads first.
export const STAGE_ORDER: Record<VipStage, number> = { clicked: 0, link_sent: 1, no_link: 2, registered: 3 };

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function vipRange(preset: VipRangePreset, custom: { from: string; to: string }, now = new Date()) {
  switch (preset) {
    case "due":
    case "today": return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": return { from: startOfDay(addDays(now, -1)), to: endOfDay(addDays(now, -1)) };
    case "last_7": return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
    case "last_30": return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
    case "custom": return {
      from: startOfDay(new Date(`${custom.from || ymd(now)}T00:00:00`)),
      to: endOfDay(new Date(`${custom.to || custom.from || ymd(now)}T00:00:00`)),
    };
  }
}

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const UNASSIGNED = "__none__";

/** Calendar days (YYYY-MM-DD) covered by the range, oldest first. */
export function daysInRange(from: Date, to: Date, max = 31) {
  const out: string[] = [];
  for (let d = startOfDay(from); d <= to && out.length < max; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}

export function dayLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function filterByAssignee(rows: VipReportRow[], who: string) {
  if (who === "all") return rows;
  if (who === UNASSIGNED) return rows.filter((r) => !r.assignee_id);
  return rows.filter((r) => r.assignee_id === who);
}

/** Per-person results: how many customers they own, called, and won. */
export function vipScoreboard(rows: VipReportRow[]) {
  const by = new Map<string, { key: string; name: string; assigned: number; called: number; registered: number; googlePosted: number; tipped: number; tipCents: number }>();
  for (const r of rows) {
    const key = r.assignee_id ?? UNASSIGNED;
    const entry = by.get(key) ?? { key, name: r.assignee_name ?? "Unassigned", assigned: 0, called: 0, registered: 0, googlePosted: 0, tipped: 0, tipCents: 0 };
    entry.assigned += 1;
    if (r.contacted_at) entry.called += 1;
    if (r.convini_registered_at) entry.registered += 1;
    if (r.google_posted_at) entry.googlePosted += 1;
    if (r.tip_count > 0) { entry.tipped += 1; entry.tipCents += r.tip_total_cents; }
    by.set(key, entry);
  }
  return [...by.values()].sort((a, b) => (a.key === UNASSIGNED ? 1 : b.key === UNASSIGNED ? -1 : b.registered - a.registered || a.name.localeCompare(b.name)));
}

const FOLLOWUP_ORDER: Record<string, number> = { overdue: 0, due: 1 };

export function sortVipRows(rows: VipReportRow[]) {
  const today = todayYmd();
  const due = (r: VipReportRow) => FOLLOWUP_ORDER[followupState(r.next_followup_on, today) ?? ""] ?? 2;
  return [...rows].sort((a, b) =>
    due(a) - due(b)
    || STAGE_ORDER[vipNextStep(a).stage] - STAGE_ORDER[vipNextStep(b).stage]
    || b.reviewed_at.localeCompare(a.reviewed_at));
}

export function followupLabel(nextOn: string, today = todayYmd()) {
  const days = Math.round((new Date(`${nextOn}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  const when = new Date(`${nextOn}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (days === 0) return `Today (${when})`;
  if (days === 1) return `Tomorrow (${when})`;
  if (days < 0) return `${when}, ${-days} day${days === -1 ? "" : "s"} overdue`;
  return `${when} (in ${days} days)`;
}

export function summarizeVip(rows: VipReportRow[]) {
  return {
    customers: rows.length,
    tipped: rows.filter((r) => r.tip_count > 0).length,
    tipCents: rows.reduce((sum, r) => sum + (r.tip_count > 0 ? r.tip_total_cents : 0), 0),
    googleClicked: rows.filter((r) => r.google_clicked_at).length,
    googlePosted: rows.filter((r) => r.google_posted_at).length,
    linkSent: rows.filter((r) => r.convini_link_sent_at).length,
    clicked: rows.filter((r) => r.convini_clicked_at).length,
    registered: rows.filter((r) => r.convini_registered_at).length,
  };
}

type Report = Awaited<ReturnType<typeof getVipReport>>;
type VipPatch = {
  googlePostedAt?: string | null;
  googleStars?: number | null;
  conviniLinkSentAt?: string | null;
  conviniRegisteredAt?: string | null;
  contactedAt?: string | null;
  notes?: string | null;
};

export function VipCustomersPanel({ companyId, companySlug }: { companyId: string; companySlug: string }) {
  const fetchReport = useServerFn(getVipReport);
  const [preset, setPreset] = useState<VipRangePreset>("today");
  const [custom, setCustom] = useState({ from: ymd(new Date()), to: ymd(new Date()) });
  const [stage, setStage] = useState<VipStageFilter>("all");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [who, setWho] = useState<string>("all");
  const [showNames, setShowNames] = useState(false);
  const assignDay = useServerFn(assignVipFollowupDay);

  const range = useMemo(() => vipRange(preset, custom), [preset, custom]);
  const days = useMemo(() => (preset === "due" ? [] : daysInRange(range.from, range.to)), [preset, range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReport({ data: {
        companyId,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        fromDay: days[0],
        toDay: days[days.length - 1],
        dueOn: preset === "due" ? todayYmd() : undefined,
        today: todayYmd(),
      } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load VIP customers.");
    } finally {
      setLoading(false);
    }
  }, [companyId, fetchReport, range, days, preset]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const all = sortVipRows(filterByAssignee(report?.rows ?? [], who));
    return stage === "all" ? all : all.filter((r) => vipNextStep(r).stage === stage);
  }, [report, stage, who]);
  const summary = useMemo(() => summarizeVip(filterByAssignee(report?.rows ?? [], who)), [report, who]);
  const board = useMemo(() => vipScoreboard(report?.rows ?? []), [report]);
  const staff = report?.staff ?? [];
  const activeStaff = staff.filter((p) => p.active);
  const perDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of report?.rows ?? []) counts[r.review_day] = (counts[r.review_day] ?? 0) + 1;
    return counts;
  }, [report]);

  async function setDayPerson(day: string, staffId: string) {
    setError(null);
    try {
      await assignDay({ data: { companyId, day, staffId: staffId === UNASSIGNED ? null : staffId } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the assignment.");
    }
  }

  function openPrint() {
    const params = new URLSearchParams({
      companyId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      stage,
      assignee: who,
      due: preset === "due" ? todayYmd() : "",
      autoprint: "true",
    });
    window.open(`/print/vip?${params.toString()}`, "_blank", "noopener");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://bluecollartips.app";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Customers who answered a GoHighLevel review request. These customers already engage with you, so work them
        toward a Convini app sign-up. The hottest leads are listed first.
      </p>

      {preset !== "due" && (report?.dueCount ?? 0) > 0 && (
        <button type="button" onClick={() => setPreset("due")} className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-900">
          <span><span className="font-semibold">{report?.dueCount} follow-up call{report?.dueCount === 1 ? "" : "s"} due</span> today or overdue.</span>
          <span className="font-semibold underline">Show them</span>
        </button>
      )}
      {preset === "due" && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
          Showing everyone whose follow-up call is due today or overdue, whenever they left their review.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Dates
          <Select value={preset} onValueChange={(v) => setPreset(v as VipRangePreset)}>
            <SelectTrigger className="mt-1 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{RANGES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {preset === "custom" && (
          <>
            <label className="text-xs text-muted-foreground">From
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">To
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            </label>
          </>
        )}
        <label className="text-xs text-muted-foreground">
          Show
          <Select value={stage} onValueChange={(v) => setStage(v as VipStageFilter)}>
            <SelectTrigger className="mt-1 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGE_FILTERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="text-xs text-muted-foreground">
          Assigned to
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="mt-1 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {staff.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</SelectItem>)}
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <button type="button" onClick={openPrint} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          {who === "all" ? "Print daily report" : `Print ${who === UNASSIGNED ? "unassigned" : staff.find((p) => p.id === who)?.name ?? ""} list`}
        </button>
        <button type="button" onClick={() => void load()} className="rounded-md border border-border px-3 py-2 text-sm">Refresh</button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Who follows up each day</div>
            <button type="button" onClick={() => setShowNames((v) => !v)} className="text-xs underline">{showNames ? "Done" : "Edit names"}</button>
          </div>
          {showNames ? (
            <StaffEditor companyId={companyId} staff={staff} onSaved={load} />
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {preset === "due" && <li className="py-2 text-xs text-muted-foreground">Pick a date range above to assign days.</li>}
              {[...days].reverse().map((day) => {
                const assigned = report?.dayAssignments?.[day] ?? UNASSIGNED;
                return (
                  <li key={day} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{dayLabel(day)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{perDay[day] ?? 0} customer{(perDay[day] ?? 0) === 1 ? "" : "s"}</span>
                    </span>
                    <Select value={assigned} onValueChange={(v) => void setDayPerson(day, v)}>
                      <SelectTrigger className="h-8 w-40 text-xs" aria-label={`Assigned to for ${dayLabel(day)}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>— Unassigned —</SelectItem>
                        {staff.filter((p) => p.active || p.id === assigned).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
              {activeStaff.length === 0 && <li className="py-2 text-xs text-muted-foreground">Add the people who make follow-up calls with “Edit names”.</li>}
            </ul>
          )}
          {days.length >= 31 && <p className="mt-1 text-xs text-muted-foreground">Showing the first 31 days of this range.</p>}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold">Scoreboard</div>
          {board.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No customers in this range yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Person</th>
                    <th className="px-2 py-1 text-right font-medium">Assigned</th>
                    <th className="px-2 py-1 text-right font-medium">Called</th>
                    <th className="px-2 py-1 text-right font-medium">Convini</th>
                    <th className="px-2 py-1 text-right font-medium">Google</th>
                    <th className="py-1 pl-2 text-right font-medium">Tips</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {board.map((b) => (
                    <tr key={b.key} className={b.key === UNASSIGNED ? "text-muted-foreground" : ""}>
                      <td className="py-1.5 pr-2">
                        <button type="button" onClick={() => setWho(b.key)} className="font-medium underline-offset-2 hover:underline">{b.name}</button>
                      </td>
                      <td className="px-2 py-1.5 text-right">{b.assigned}</td>
                      <td className="px-2 py-1.5 text-right">{b.called}<span className="text-xs text-muted-foreground"> / {b.assigned}</span></td>
                      <td className="px-2 py-1.5 text-right font-semibold">{b.registered}</td>
                      <td className="px-2 py-1.5 text-right">{b.googlePosted}</td>
                      <td className="py-1.5 pl-2 text-right">{b.tipped ? dollars(b.tipCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">Wins = Convini registrations and Google reviews posted. Click a name to see their list.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Responded" value={summary.customers} />
        <Tile label="Tipped" value={`${summary.tipped}`} sub={summary.tipCents ? dollars(summary.tipCents) : undefined} />
        <Tile label="Went to Google" value={summary.googleClicked} />
        <Tile label="Google posted" value={summary.googlePosted} />
        <Tile label="Convini link sent" value={summary.linkSent} />
        <Tile label="Opened Convini" value={summary.clicked} />
        <Tile label="Registered" value={summary.registered} strong />
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && !report ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No customers match these dates and filters.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => <VipRow key={row.rating_id} row={row} companyId={companyId} staff={staff} calls={report?.calls?.[row.job_id] ?? []} onSaved={load} />)}
        </ul>
      )}
      {report?.truncated && <p className="text-xs text-muted-foreground">Showing the most recent 1,000. Narrow the dates to see everything.</p>}

      <div className="rounded-md border border-border p-3 text-sm">
        <button type="button" onClick={() => setShowSetup((s) => !s)} className="font-semibold">
          {showSetup ? "▾" : "▸"} Connect GoHighLevel and Convini
        </button>
        {showSetup && (
          <div className="mt-3 space-y-3 text-xs text-muted-foreground">
            <div>
              <div className="font-semibold text-foreground">1. Use this tracked Convini link in GHL messages and drip campaigns</div>
              <code className="mt-1 block break-all rounded bg-muted p-2 text-foreground">{`${origin}/go/convini?c=${companySlug}&cid={{contact.id}}`}</code>
              It records who opened it, then sends them straight to Convini.
            </div>
            <div>
              <div className="font-semibold text-foreground">2. Tell us when the link was sent (GHL workflow → Webhook action, right after the SMS/email step)</div>
              <code className="mt-1 block break-all rounded bg-muted p-2 text-foreground">{`POST ${origin}/api/public/webhooks/ghl-events`}</code>
              Header <code>X-Webhook-Secret</code>: the same secret as your review webhook. Body:
              <code className="mt-1 block whitespace-pre-wrap rounded bg-muted p-2 text-foreground">{`{ "companySlug": "${companySlug}", "event": "convini_link_sent", "ghlContactId": "{{contact.id}}" }`}</code>
            </div>
            <div>
              <div className="font-semibold text-foreground">3. Registrations</div>
              Convini (or a GHL workflow triggered by a “Convini registered” tag) posts the same webhook with
              <code> "event": "convini_registered"</code>, plus the customer’s <code>phone</code>, <code>email</code>, <code>ghlContactId</code> or <code>jobId</code>.
              Until that's connected, mark registrations by hand below.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: number | string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? "border-primary" : "border-border"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const STAGE_BADGE: Record<VipStage, string> = {
  clicked: "bg-red-100 text-red-800",
  link_sent: "bg-amber-100 text-amber-800",
  no_link: "bg-slate-100 text-slate-700",
  registered: "bg-green-100 text-green-800",
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${ymd(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

type StaffList = Report["staff"];
const FOLLOW_DAY = "__day__";

type CallList = Report["calls"][string];

const FOLLOWUP_TONE: Record<Exclude<FollowupState, null>, string> = {
  overdue: "border-red-300 bg-red-50 text-red-800",
  due: "border-amber-300 bg-amber-50 text-amber-900",
  scheduled: "border-border bg-muted/40 text-foreground",
};

function VipRow({ row, companyId, staff, calls, onSaved }: { row: VipReportRow; companyId: string; staff: StaffList; calls: CallList; onSaved: () => Promise<void> }) {
  const save = useServerFn(updateVipFollowup);
  const setNext = useServerFn(setVipNextFollowup);
  const [logging, setLogging] = useState(false);
  const followup = followupState(row.next_followup_on);
  const assignCustomer = useServerFn(assignVipFollowupCustomer);
  const next = vipNextStep(row);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    googlePostedAt: toLocalInput(row.google_posted_at),
    googleStars: row.google_stars ? String(row.google_stars) : "",
    conviniLinkSentAt: toLocalInput(row.convini_link_sent_at),
    conviniRegisteredAt: toLocalInput(row.convini_registered_at),
    contactedAt: toLocalInput(row.contacted_at),
    notes: row.notes ?? "",
  });
  const nowLocal = () => toLocalInput(new Date().toISOString());

  async function quick(patch: VipPatch) {
    setBusy(true);
    setErr(null);
    try {
      await save({ data: { companyId, jobId: row.job_id, ...patch } });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    await quick({
      googlePostedAt: fromLocalInput(form.googlePostedAt),
      googleStars: form.googleStars ? Number(form.googleStars) : null,
      conviniLinkSentAt: fromLocalInput(form.conviniLinkSentAt),
      conviniRegisteredAt: fromLocalInput(form.conviniRegisteredAt),
      contactedAt: fromLocalInput(form.contactedAt),
      notes: form.notes.trim() || null,
    });
    setEditing(false);
  }

  async function reassign(value: string) {
    setBusy(true);
    setErr(null);
    try {
      await assignCustomer({ data: { companyId, jobId: row.job_id, staffId: value === FOLLOW_DAY ? null : value } });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reassign");
    } finally {
      setBusy(false);
    }
  }

  const phoneHref = row.customer_phone ? `tel:${row.customer_phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{row.customer_name || "Customer"}</div>
          <div className="text-sm text-muted-foreground">
            {phoneHref ? <a href={phoneHref} className="underline">{row.customer_phone}</a> : "No phone"}
            {row.customer_email ? ` · ${row.customer_email}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">Towbook job #{row.job_id}{row.driver_name ? ` · ${row.driver_name}` : ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STAGE_BADGE[next.stage]}`}>
            {STAGE_FILTERS.find((s) => s.id === next.stage)?.label}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Follow-up by
            <Select value={row.assignee_source === "customer" && row.assignee_id ? row.assignee_id : FOLLOW_DAY} onValueChange={(v) => void reassign(v)} disabled={busy}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_DAY}>
                  {row.assignee_source === "day" && row.assignee_name ? `${row.assignee_name} (day)` : "Same as the day's person"}
                </SelectItem>
                {staff.filter((p) => p.active || p.id === row.assignee_id).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>

      {(row.contacted_at || row.notes) && (
        <div className="mt-3 rounded-md border-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300">
          {row.contacted_at && (
            <div>
              <span className="font-bold uppercase tracking-wide">Last contacted:</span>{" "}
              <span className="font-semibold">{fmtWhen(calls[0]?.calledAt ?? row.contacted_at)}</span>
              {calls[0]?.loggedBy ? <> · {calls[0].loggedBy}</> : null}
            </div>
          )}
          {calls[0]?.note && <div className="mt-0.5 whitespace-pre-wrap font-semibold">“{calls[0].note}”</div>}
          {row.notes && <div className="mt-0.5 whitespace-pre-wrap"><span className="font-bold">Notes:</span> {row.notes}</div>}
        </div>
      )}

      <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span><span className="text-amber-500">{"★".repeat(row.stars)}</span><span className="text-muted-foreground/40">{"★".repeat(5 - row.stars)}</span></span>
          <span className="text-xs text-muted-foreground">Review left {fmtWhen(row.reviewed_at)}</span>
        </div>
        {row.feedback?.trim() ? <p className="mt-1 whitespace-pre-wrap">{row.feedback.trim()}</p> : <p className="mt-1 text-xs italic text-muted-foreground">Rating only — no written comment.</p>}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="Tip">
          {row.tip_count > 0
            ? <>{dollars(row.tip_total_cents)}{row.tip_count > 1 ? ` (${row.tip_count} tips)` : ""} · {fmtWhen(row.tip_first_at)}{row.tip_refunded ? " · refunded/disputed" : ""}</>
            : "No tip"}
        </Fact>
        <Fact label="Google review">
          {row.google_posted_at
            ? <>Posted {fmtWhen(row.google_posted_at)}{row.google_stars ? ` · ${row.google_stars}★` : ""}</>
            : row.google_clicked_at ? <>Went to Google {fmtWhen(row.google_clicked_at)} (not confirmed yet)</> : "Not yet"}
        </Fact>
        <Fact label="Convini app">
          <div>Link sent: {fmtWhen(row.convini_link_sent_at) ?? "—"}{row.convini_link_sent_count > 1 ? ` (${row.convini_link_sent_count}×)` : ""}</div>
          <div>Opened: {fmtWhen(row.convini_clicked_at) ?? "—"}{row.convini_click_count > 1 ? ` (${row.convini_click_count}×)` : ""}</div>
          <div className="font-semibold">Registered: {fmtWhen(row.convini_registered_at) ?? "—"}</div>
        </Fact>
      </dl>

      <div className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-sm"><span className="font-semibold">Next step:</span> {next.action}</div>
      {row.next_followup_on && followup && (
        <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${FOLLOWUP_TONE[followup]}`}>
          <span><span className="font-semibold">Next follow-up call:</span> {followupLabel(row.next_followup_on)}</span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await setNext({ data: { companyId, jobId: row.job_id, nextFollowupOn: null } }); await onSaved(); }
              catch (e) { setErr(e instanceof Error ? e.message : "Could not clear"); }
              finally { setBusy(false); }
            }}
            className="text-xs underline disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}
      {calls.length > 0 && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Calls{row.call_count > calls.length ? ` (latest ${calls.length} of ${row.call_count})` : ` (${calls.length})`}
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {calls.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{fmtWhen(c.calledAt)}</span>
                {c.loggedBy ? <span className="text-muted-foreground"> · {c.loggedBy}</span> : null}
                {c.note ? <span className="whitespace-pre-wrap"> · {c.note}</span> : null}
                {c.nextFollowupOn ? <span className="text-muted-foreground"> · call again {new Date(`${c.nextFollowupOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!row.convini_registered_at && (
          <button type="button" disabled={busy} onClick={() => void quick({ conviniRegisteredAt: new Date().toISOString() })} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            Mark registered on Convini
          </button>
        )}
        {!row.google_posted_at && (
          <button type="button" disabled={busy} onClick={() => void quick({ googlePostedAt: new Date().toISOString() })} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">
            Mark Google review posted
          </button>
        )}
        <button type="button" onClick={() => setLogging((v) => !v)} className="rounded-md border border-primary px-3 py-1.5 text-xs font-semibold text-primary">
          {logging ? "Cancel call log" : "Log call / follow up next"}
        </button>
        <button type="button" onClick={() => setEditing((e) => !e)} className="rounded-md border border-border px-3 py-1.5 text-xs">
          {editing ? "Cancel" : "Edit details / notes"}
        </button>
      </div>

      {logging && (
        <LogCallForm
          companyId={companyId}
          jobId={row.job_id}
          onDone={async () => { setLogging(false); await onSaved(); }}
        />
      )}

      {editing && (
        <div className="mt-3 grid gap-3 rounded-md border border-border p-3 text-xs sm:grid-cols-2">
          <DateField label="Google review posted" value={form.googlePostedAt} onChange={(v) => setForm((f) => ({ ...f, googlePostedAt: v }))} onNow={() => setForm((f) => ({ ...f, googlePostedAt: nowLocal() }))} />
          <label className="text-muted-foreground">Google stars
            <select value={form.googleStars} onChange={(e) => setForm((f) => ({ ...f, googleStars: e.target.value }))} className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="">—</option>
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s}★</option>)}
            </select>
          </label>
          <DateField label="Convini link sent" value={form.conviniLinkSentAt} onChange={(v) => setForm((f) => ({ ...f, conviniLinkSentAt: v }))} onNow={() => setForm((f) => ({ ...f, conviniLinkSentAt: nowLocal() }))} />
          <DateField label="Registered on Convini" value={form.conviniRegisteredAt} onChange={(v) => setForm((f) => ({ ...f, conviniRegisteredAt: v }))} onNow={() => setForm((f) => ({ ...f, conviniRegisteredAt: nowLocal() }))} />
          <DateField label="Last contacted" value={form.contactedAt} onChange={(v) => setForm((f) => ({ ...f, contactedAt: v }))} onNow={() => setForm((f) => ({ ...f, contactedAt: nowLocal() }))} />
          <label className="text-muted-foreground sm:col-span-2">Notes
            <textarea value={form.notes} maxLength={2000} rows={3} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save</button>
          </div>
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function DateField({ label, value, onChange, onNow }: { label: string; value: string; onChange: (v: string) => void; onNow: () => void }) {
  return (
    <label className="text-muted-foreground">{label}
      <span className="mt-1 flex gap-1">
        <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        <button type="button" onClick={onNow} className="rounded-md border border-border px-2 text-xs">Now</button>
        {value && <button type="button" onClick={() => onChange("")} className="rounded-md border border-border px-2 text-xs">Clear</button>}
      </span>
    </label>
  );
}

function StaffEditor({ companyId, staff, onSaved }: { companyId: string; staff: StaffList; onSaved: () => Promise<void> }) {
  const saveStaff = useServerFn(saveVipFollowupStaff);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(data: { id?: string; name?: string; active?: boolean }) {
    setBusy(true);
    setErr(null);
    try {
      await saveStaff({ data: { companyId, ...data } });
      await onSaved();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 text-sm">
      <ul className="divide-y divide-border">
        {staff.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className={p.active ? "" : "text-muted-foreground line-through"}>{p.name}</span>
            <button type="button" disabled={busy} onClick={() => void run({ id: p.id, active: !p.active })} className="rounded-md border border-border px-2 py-0.5 text-xs disabled:opacity-50">
              {p.active ? "Remove" : "Bring back"}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim() && (await run({ name: name.trim() }))) setName("");
        }}
      >
        <input id="vip-staff-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Add a name" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">Add</button>
      </form>
      <p className="text-[11px] text-muted-foreground">Removed names keep their past customers and results; they just stop showing in the pickers.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

const FOLLOW_UP_CHOICES: Array<{ id: string; label: string; days: number | null }> = [
  { id: "none", label: "No more calls", days: null },
  { id: "1", label: "Tomorrow", days: 1 },
  { id: "3", label: "In 3 days", days: 3 },
  { id: "7", label: "In 1 week", days: 7 },
  { id: "14", label: "In 2 weeks", days: 14 },
  { id: "date", label: "Pick a date", days: null },
];

function LogCallForm({ companyId, jobId, onDone }: { companyId: string; jobId: string; onDone: () => Promise<void> }) {
  const logCall = useServerFn(logVipFollowupCall);
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState("7");
  const [date, setDate] = useState(ymd(addDays(new Date(), 7)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nextOn = choice === "none" ? null : choice === "date" ? date || null : ymd(addDays(new Date(), Number(choice)));

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (choice === "date" && !date) { setErr("Pick the follow-up date."); return; }
        setBusy(true);
        setErr(null);
        try {
          await logCall({ data: { companyId, jobId, note: note.trim() || null, nextFollowupOn: nextOn } });
          await onDone();
        } catch (error) {
          setErr(error instanceof Error ? error.message : "Could not save the call");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-xs text-muted-foreground" htmlFor={`call-note-${jobId}`}>What happened on the call?</label>
      <textarea
        id={`call-note-${jobId}`}
        value={note}
        maxLength={2000}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Very happy. Will download Convini and leave a Google review."
        className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
      <fieldset>
        <legend className="text-xs text-muted-foreground">Follow up next</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {FOLLOW_UP_CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChoice(c.id)}
              aria-pressed={choice === c.id}
              className={`rounded-full border px-3 py-1 text-xs ${choice === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {choice === "date" && (
          <input id={`call-date-${jobId}`} type="date" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} className="mt-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {nextOn ? <>They'll show up under <b>Follow-ups due</b> on {new Date(`${nextOn}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.</> : "No further call scheduled."}
        </p>
      </fieldset>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save call</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </form>
  );
}
