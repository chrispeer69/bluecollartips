import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getTipPayrollReport } from "@/lib/tip-payroll.functions";
import { addDaysYmd, lastCompletedWeekStart, payWeekStart } from "@/lib/tip-payroll";
import { dollars } from "@/lib/constants";

const searchSchema = z.object({
  companyId: z.string().uuid(),
  // Any day in the pay week (Saturday–Friday).
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  autoprint: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()).default(false),
});

export const Route = createFileRoute("/print/tip-payroll")({
  head: () => ({
    meta: [
      { title: "Tip payroll report — Blue Collar Tips" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: TipPayrollPage,
});

type Report = Awaited<ReturnType<typeof getTipPayrollReport>>;
type Employee = Report["employees"][number];
type Tip = Employee["cardTips"][number];

const SOURCE_LABEL: Record<string, string> = {
  stripe: "Card", cash: "Cash", venmo: "Venmo", cashapp: "Cash App", zelle: "Zelle", paypal: "PayPal", other: "Other",
};

function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
const longDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const tipDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric" });
const tipTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

function TipPayrollPage() {
  const search = useSearch({ from: "/print/tip-payroll" });
  const navigate = useNavigate({ from: "/print/tip-payroll" });
  const fetchReport = useServerFn(getTipPayrollReport);
  const week = payWeekStart(search.week ?? lastCompletedWeekStart(localToday()));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    (async () => {
      try {
        const r = await fetchReport({ data: { companyId: search.companyId, weekOf: week } });
        if (cancelled) return;
        setReport(r);
        if (search.autoprint) setTimeout(() => window.print(), 400);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the report.");
      }
    })();
    return () => { cancelled = true; };
  }, [fetchReport, search.companyId, week, search.autoprint]);

  const go = (days: number) => navigate({ search: { companyId: search.companyId, week: addDaysYmd(week, days), autoprint: false } });

  if (error) return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-red-700">{error}</div>;

  const brand = report?.company.primary_color || "#0b2545";
  const paid = report?.employees.filter((e) => e.driverId) ?? [];
  const withDetail = report?.employees.filter((e) => e.cardTips.length || e.heldTips.length || e.otherTips.length) ?? [];
  const flagged = paid.filter((e) => e.appPayoutCents > 0);

  return (
    <div className="min-h-screen bg-white p-8 text-black print:p-0" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          .no-print { display: none !important; }
          .page-break { break-before: page; page-break-before: always; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
      `}</style>

      <div className="no-print mx-auto mb-5 flex max-w-[7.5in] flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(-7)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5">← Previous week</button>
          <span className="font-medium">{longDay(week)} – {longDay(addDaysYmd(week, 6))}</span>
          <button type="button" onClick={() => go(7)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5">Next week →</button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} disabled={!report} className="rounded-md px-3 py-1.5 text-white disabled:opacity-50" style={{ background: brand }}>Print / Save as PDF</button>
          <button type="button" onClick={() => window.close()} className="rounded-md border border-gray-300 bg-white px-3 py-1.5">Close</button>
        </div>
      </div>

      {!report ? (
        <div className="grid min-h-[50vh] place-items-center text-sm text-gray-500">Preparing tip payroll…</div>
      ) : (
        <div className="mx-auto max-w-[7.5in] text-[12px] leading-snug">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 pb-3" style={{ borderColor: brand }}>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-gray-500">{report.company.name}</div>
              <h1 className="mt-0.5 text-2xl font-bold" style={{ color: brand }}>Tip Payroll Report</h1>
              <div className="mt-1 text-sm font-semibold">Pay week: {longDay(report.week.start)} – {longDay(report.week.end)}</div>
              <div className="text-[11px] text-gray-500">Saturday 12:00 AM through Friday 11:59 PM, Eastern time</div>
            </div>
            {report.company.logo_url && <img src={report.company.logo_url} alt="" className="h-12 max-w-[2.2in] object-contain" />}
          </div>

          {/* Headline */}
          <div className="avoid-break mt-4 grid grid-cols-3 gap-3">
            <div className="col-span-1 rounded-md border-2 p-3" style={{ borderColor: brand }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Total to add to payroll</div>
              <div className="num mt-1 text-left text-2xl font-bold" style={{ color: brand, textAlign: "left" }}>{dollars(report.totals.payrollCents)}</div>
            </div>
            <div className="rounded-md border border-gray-300 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Card tips collected</div>
              <div className="mt-1 text-lg font-semibold">{dollars(report.totals.cardGrossCents)}</div>
              <div className="text-[11px] text-gray-500">{report.totals.cardCount} tip{report.totals.cardCount === 1 ? "" : "s"}</div>
            </div>
            <div className="rounded-md border border-gray-300 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Employees with tips</div>
              <div className="mt-1 text-lg font-semibold">{paid.filter((e) => e.payrollCents > 0).length} of {paid.length}</div>
              <div className="text-[11px] text-gray-500">Employee keeps {report.company.employeePct}% of each card tip</div>
            </div>
          </div>

          {/* Payroll table */}
          <h2 className="mt-5 text-sm font-bold uppercase tracking-wide" style={{ color: brand }}>Add to each paycheck</h2>
          <table className="avoid-break mt-1.5 w-full border-collapse">
            <thead>
              <tr className="border-y-2 border-gray-700 text-left text-[11px] uppercase tracking-wide">
                <th className="py-1.5 pr-2">Employee</th>
                <th className="px-2 py-1.5">Emp. ID</th>
                <th className="num px-2 py-1.5">Card tips</th>
                <th className="num px-2 py-1.5">Collected</th>
                <th className="num px-2 py-1.5" style={{ background: "#f1f5f9" }}>Add to pay</th>
                <th className="py-1.5 pl-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((e) => (
                <tr key={e.driverId} className="border-b border-gray-300 align-top">
                  <td className="py-1.5 pr-2 font-semibold">{e.name}</td>
                  <td className="px-2 py-1.5 text-gray-600">{e.employeeId ?? "—"}</td>
                  <td className="num px-2 py-1.5">{e.cardCount || "—"}</td>
                  <td className="num px-2 py-1.5">{e.cardGrossCents ? dollars(e.cardGrossCents) : "—"}</td>
                  <td className="num px-2 py-1.5 text-[13px] font-bold" style={{ background: "#f1f5f9" }}>{dollars(e.payrollCents)}</td>
                  <td className="py-1.5 pl-2 text-[11px]">
                    {e.appPayoutCents > 0 && <div className="font-semibold text-red-700">Paid {dollars(e.appPayoutCents)} through the app this week: check before adding</div>}
                    {e.heldTips.length > 0 && <div className="text-amber-800">{e.heldTips.length} refunded/disputed tip{e.heldTips.length === 1 ? "" : "s"} not included</div>}
                    {e.otherCents > 0 && <div className="text-gray-600">{dollars(e.otherCents)} cash/other already received (not added)</div>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 font-bold">
                <td className="py-1.5 pr-2" colSpan={2}>Total</td>
                <td className="num px-2 py-1.5">{report.totals.cardCount}</td>
                <td className="num px-2 py-1.5">{dollars(report.totals.cardGrossCents)}</td>
                <td className="num px-2 py-1.5 text-[13px]" style={{ background: "#f1f5f9" }}>{dollars(report.totals.payrollCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          {(flagged.length > 0 || report.unassignedCardTips || report.totals.heldCount > 0) && (
            <div className="avoid-break mt-3 rounded-md border border-amber-400 bg-amber-50 p-2.5 text-[11px]">
              <div className="font-bold uppercase tracking-wide text-amber-900">Check before running payroll</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {flagged.length > 0 && <li><b>Paid through the app:</b> {flagged.map((e) => `${e.name} (${dollars(e.appPayoutCents)})`).join(", ")} also received a tip payout through Blue Collar Tips this week. Don't pay the same tips twice.</li>}
                {report.unassignedCardTips && <li><b>{report.unassignedCardTips.count} card tip{report.unassignedCardTips.count === 1 ? "" : "s"} ({dollars(report.unassignedCardTips.grossCents)})</b> are not assigned to an employee. Assign them in Tips &amp; payments, then reprint.</li>}
                {report.totals.heldCount > 0 && <li><b>{report.totals.heldCount} refunded or disputed card tip{report.totals.heldCount === 1 ? "" : "s"}</b> are left out of the totals.</li>}
              </ul>
            </div>
          )}

          {/* Sign-off */}
          <div className="avoid-break mt-5 grid grid-cols-3 gap-6 text-[11px] text-gray-700">
            {["Prepared by", "Approved by", "Entered into payroll (date)"].map((label) => (
              <div key={label}>
                <div className="h-7 border-b border-gray-500" />
                <div className="mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Detail */}
          {withDetail.length > 0 && (
            <section className="page-break mt-8 print:mt-0">
              <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: brand }}>Tip detail — {longDay(report.week.start)} – {longDay(report.week.end)}</h2>
              {withDetail.map((e) => (
                <div key={e.driverId ?? "company"} className="avoid-break mt-3">
                  <div className="flex items-baseline justify-between border-b border-gray-700 pb-0.5">
                    <span className="font-bold">{e.name}{e.employeeId ? <span className="font-normal text-gray-600"> · ID {e.employeeId}</span> : null}</span>
                    {e.driverId && <span className="font-bold">Add to pay: {dollars(e.payrollCents)}</span>}
                  </div>
                  <TipTable tips={e.cardTips} kind="card" />
                  {e.heldTips.length > 0 && (
                    <>
                      <div className="mt-1 text-[11px] font-semibold text-amber-800">Refunded or disputed (not paid)</div>
                      <TipTable tips={e.heldTips} kind="held" />
                    </>
                  )}
                  {e.otherTips.length > 0 && (
                    <>
                      <div className="mt-1 text-[11px] font-semibold text-gray-600">Cash and other tips the employee reported (already received, not added)</div>
                      <TipTable tips={e.otherTips} kind="other" />
                    </>
                  )}
                </div>
              ))}
            </section>
          )}

          <div className="mt-6 border-t pt-2 text-[10px] text-gray-500">
            Card tips are split {report.company.employeePct}% employee{report.company.companyPct ? ` · ${report.company.companyPct}% ${report.company.name}` : ""} · 10% Blue Collar Tips. "Add to pay" is the employee share of card tips paid this week.
            Generated {new Date().toLocaleString("en-US")} by Blue Collar Tips.
          </div>
        </div>
      )}
    </div>
  );
}

function TipTable({ tips, kind }: { tips: Tip[]; kind: "card" | "held" | "other" }) {
  if (!tips.length) return <div className="py-1 text-[11px] italic text-gray-400">No card tips this week.</div>;
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="text-left text-[10px] uppercase text-gray-500">
          <th className="py-1 pr-2 font-medium">Day</th>
          <th className="px-2 py-1 font-medium">Time</th>
          <th className="px-2 py-1 font-medium">Customer</th>
          <th className="px-2 py-1 font-medium">Job #</th>
          <th className="px-2 py-1 font-medium">Type</th>
          <th className="num px-2 py-1 font-medium">Tip</th>
          <th className="num py-1 pl-2 font-medium">{kind === "card" ? "Employee share" : ""}</th>
        </tr>
      </thead>
      <tbody>
        {tips.map((t) => (
          <tr key={t.id} className={`border-t border-gray-200 ${kind === "held" ? "text-gray-500 line-through" : ""}`}>
            <td className="py-0.5 pr-2">{tipDay(t.tippedAt)}</td>
            <td className="px-2 py-0.5">{tipTime(t.tippedAt)}</td>
            <td className="px-2 py-0.5">{t.customerName ?? "—"}</td>
            <td className="px-2 py-0.5">{t.jobId ?? "—"}</td>
            <td className="px-2 py-0.5">{SOURCE_LABEL[t.source] ?? t.source}{t.refunded ? " · refunded" : t.disputed ? " · disputed" : ""}</td>
            <td className="num px-2 py-0.5">{dollars(t.amountCents)}</td>
            <td className="num py-0.5 pl-2 font-semibold">{kind === "card" ? dollars(t.employeeCents) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
