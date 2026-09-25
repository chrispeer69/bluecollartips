import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getVipReport, updateVipFollowup } from "@/lib/vip.functions";
import { vipNextStep, type VipReportRow, type VipStage } from "@/lib/vip";
import { dollars } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type VipRangePreset = "today" | "yesterday" | "last_7" | "last_30" | "custom";
export type VipStageFilter = "all" | VipStage;

const RANGES: Array<{ id: VipRangePreset; label: string }> = [
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

export function sortVipRows(rows: VipReportRow[]) {
  return [...rows].sort((a, b) =>
    STAGE_ORDER[vipNextStep(a).stage] - STAGE_ORDER[vipNextStep(b).stage]
    || b.reviewed_at.localeCompare(a.reviewed_at));
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

  const range = useMemo(() => vipRange(preset, custom), [preset, custom]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReport({ data: { companyId, from: range.from.toISOString(), to: range.to.toISOString() } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load VIP customers.");
    } finally {
      setLoading(false);
    }
  }, [companyId, fetchReport, range]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const all = sortVipRows(report?.rows ?? []);
    return stage === "all" ? all : all.filter((r) => vipNextStep(r).stage === stage);
  }, [report, stage]);
  const summary = useMemo(() => summarizeVip(report?.rows ?? []), [report]);

  function openPrint() {
    const params = new URLSearchParams({
      companyId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      stage,
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
        <button type="button" onClick={openPrint} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Print daily report
        </button>
        <button type="button" onClick={() => void load()} className="rounded-md border border-border px-3 py-2 text-sm">Refresh</button>
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
          {rows.map((row) => <VipRow key={row.rating_id} row={row} companyId={companyId} onSaved={load} />)}
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

function VipRow({ row, companyId, onSaved }: { row: VipReportRow; companyId: string; onSaved: () => Promise<void> }) {
  const save = useServerFn(updateVipFollowup);
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
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STAGE_BADGE[next.stage]}`}>
          {STAGE_FILTERS.find((s) => s.id === next.stage)?.label}
        </span>
      </div>

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
      {(row.contacted_at || row.notes) && (
        <div className="mt-2 text-xs text-muted-foreground">
          {row.contacted_at && <>Last contacted {fmtWhen(row.contacted_at)}. </>}
          {row.notes && <span className="whitespace-pre-wrap">Notes: {row.notes}</span>}
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
        <button type="button" disabled={busy} onClick={() => void quick({ contactedAt: new Date().toISOString() })} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">
          Contacted today
        </button>
        <button type="button" onClick={() => setEditing((e) => !e)} className="rounded-md border border-border px-3 py-1.5 text-xs">
          {editing ? "Cancel" : "Edit details / notes"}
        </button>
      </div>

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
