import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getVipReport } from "@/lib/vip.functions";
import { vipNextStep } from "@/lib/vip";
import { dollars } from "@/lib/constants";
import { STAGE_FILTERS, UNASSIGNED, filterByAssignee, fmtWhen, sortVipRows, summarizeVip } from "@/components/VipCustomersPanel";

const searchSchema = z.object({
  companyId: z.string().uuid(),
  from: z.string().optional(),
  to: z.string().optional(),
  stage: z.enum(["all", "clicked", "link_sent", "no_link", "registered"]).default("all"),
  assignee: z.string().max(64).default("all"),
  autoprint: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()).default(true),
});

export const Route = createFileRoute("/print/vip")({
  head: () => ({
    meta: [
      { title: "VIP customer follow-up — Blue Collar Tips" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: PrintVipPage,
});

type Report = Awaited<ReturnType<typeof getVipReport>>;

function PrintVipPage() {
  const search = useSearch({ from: "/print/vip" });
  const fetchReport = useServerFn(getVipReport);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchReport({ data: { companyId: search.companyId, from: search.from, to: search.to } });
        if (cancelled) return;
        setReport(r);
        if (search.autoprint) setTimeout(() => window.print(), 400);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the report.");
      }
    })();
    return () => { cancelled = true; };
  }, [fetchReport, search.companyId, search.from, search.to, search.autoprint]);

  const rows = useMemo(() => {
    const all = sortVipRows(filterByAssignee(report?.rows ?? [], search.assignee));
    return search.stage === "all" ? all : all.filter((r) => vipNextStep(r).stage === search.stage);
  }, [report, search.stage, search.assignee]);

  if (error) return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-red-700">{error}</div>;
  if (!report) return <div className="grid min-h-screen place-items-center">Preparing report…</div>;

  const co = report.company;
  const brand = co.primary_color || "#0b2545";
  const summary = summarizeVip(filterByAssignee(report.rows, search.assignee));
  const personName = search.assignee === "all" ? null : search.assignee === UNASSIGNED ? "Unassigned" : report.staff.find((p) => p.id === search.assignee)?.name ?? null;
  const stageLabel = search.stage === "all" ? null : STAGE_FILTERS.find((s) => s.id === search.stage)?.label;

  return (
    <div className="min-h-screen bg-white p-8 text-black print:p-0" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.4in; }
          .no-print { display: none !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[10.2in] items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
        <span className="text-gray-600">{rows.length} customer{rows.length === 1 ? "" : "s"}{report.truncated ? " (most recent 1,000)" : ""}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="rounded-md px-3 py-1.5 text-white" style={{ background: brand }}>Print / Save as PDF</button>
          <button type="button" onClick={() => window.close()} className="rounded-md border border-gray-300 bg-white px-3 py-1.5">Close</button>
        </div>
      </div>

      <div className="mx-auto max-w-[10.2in]">
        <div className="flex items-start justify-between border-b-2 pb-3" style={{ borderColor: brand }}>
          <div>
            <div className="text-xs uppercase tracking-widest text-gray-500">{co.name}</div>
            <h1 className="mt-1 text-2xl font-bold" style={{ color: brand }}>VIP customer follow-up{personName ? ` — ${personName}` : ""}</h1>
            <div className="mt-1 text-xs text-gray-600">
              {rangeLabel(report.range.from, report.range.to)} · Customers who answered a review request{stageLabel ? ` · ${stageLabel}` : ""}
            </div>
          </div>
          {co.logo_url && <img src={co.logo_url} alt="" className="h-12 max-w-[2.5in] object-contain" />}
        </div>

        <div className="mt-3 grid grid-cols-7 gap-2 text-center text-xs">
          <Cell label="Responded" v={summary.customers} />
          <Cell label="Tipped" v={`${summary.tipped}${summary.tipCents ? ` · ${dollars(summary.tipCents)}` : ""}`} />
          <Cell label="Went to Google" v={summary.googleClicked} />
          <Cell label="Google posted" v={summary.googlePosted} />
          <Cell label="Convini sent" v={summary.linkSent} />
          <Cell label="Opened Convini" v={summary.clicked} />
          <Cell label="Registered" v={summary.registered} />
        </div>

        {rows.length === 0 ? (
          <div className="mt-10 text-center text-sm text-gray-500">No customers for these dates.</div>
        ) : (
          <table className="mt-4 w-full border-collapse text-[11px] leading-snug">
            <thead>
              <tr className="border-b-2 border-gray-400 text-left align-bottom">
                <th className="w-[17%] p-1.5">Customer · Towbook job #</th>
                <th className="w-[27%] p-1.5">Review</th>
                <th className="w-[10%] p-1.5">Tip</th>
                <th className="w-[11%] p-1.5">Google review</th>
                <th className="w-[13%] p-1.5">Convini app</th>
                <th className="w-[22%] p-1.5">Next step · outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const next = vipNextStep(r);
                return (
                  <tr key={r.rating_id} className="avoid-break border-b border-gray-300 align-top">
                    <td className="p-1.5">
                      <div className="font-semibold">{r.customer_name || "Customer"}</div>
                      <div>{r.customer_phone || "No phone"}</div>
                      {r.customer_email && <div className="break-all text-gray-600">{r.customer_email}</div>}
                      <div className="mt-0.5 text-gray-600">Job #{r.job_id}</div>
                      {r.driver_name && <div className="text-gray-600">{r.driver_name}</div>}
                      <div className="mt-0.5 font-semibold">Follow-up: {r.assignee_name ?? "—"}</div>
                    </td>
                    <td className="p-1.5">
                      <div><span style={{ color: "#d97706" }}>{"★".repeat(r.stars)}</span><span className="text-gray-300">{"★".repeat(5 - r.stars)}</span> <span className="text-gray-600">{fmtWhen(r.reviewed_at)}</span></div>
                      {r.feedback?.trim() ? <div className="mt-0.5 whitespace-pre-wrap">{r.feedback.trim()}</div> : <div className="italic text-gray-400">No written comment</div>}
                    </td>
                    <td className="p-1.5">
                      {r.tip_count > 0 ? <><div className="font-semibold">{dollars(r.tip_total_cents)}</div><div className="text-gray-600">{fmtWhen(r.tip_first_at)}</div>{r.tip_refunded && <div className="text-red-700">refunded/disputed</div>}</> : <span className="text-gray-500">No</span>}
                    </td>
                    <td className="p-1.5">
                      {r.google_posted_at
                        ? <><div className="font-semibold">Posted{r.google_stars ? ` ${r.google_stars}★` : ""}</div><div className="text-gray-600">{fmtWhen(r.google_posted_at)}</div></>
                        : r.google_clicked_at ? <><div>Went to Google</div><div className="text-gray-600">{fmtWhen(r.google_clicked_at)}</div><div className="text-gray-500">not confirmed ☐</div></> : <span className="text-gray-500">No ☐</span>}
                    </td>
                    <td className="p-1.5">
                      <div>Sent: {fmtWhen(r.convini_link_sent_at) ?? "—"}</div>
                      <div>Opened: {fmtWhen(r.convini_clicked_at) ?? "—"}</div>
                      <div className="font-semibold">Registered: {fmtWhen(r.convini_registered_at) ?? "☐"}</div>
                    </td>
                    <td className="p-1.5">
                      <div className="font-semibold">{next.action}</div>
                      {r.notes && <div className="mt-0.5 whitespace-pre-wrap text-gray-700">Notes: {r.notes}</div>}
                      <div className="mt-2 border-b border-gray-400" />
                      <div className="mt-3 border-b border-gray-400" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-6 flex items-center justify-between border-t pt-2 text-[10px] text-gray-500">
          <span>Generated by Blue Collar Tips · {new Date().toLocaleString()}</span>
          <span>{co.name}</span>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="rounded border border-gray-300 p-1.5">
      <div className="text-[9px] uppercase text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{v}</div>
    </div>
  );
}

function rangeLabel(from: string | null, to: string | null) {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (from && to) {
    const a = fmt(from), b = fmt(to);
    return a === b ? a : `${a} – ${b}`;
  }
  if (from) return `Since ${fmt(from)}`;
  if (to) return `Through ${fmt(to)}`;
  return "All time";
}
