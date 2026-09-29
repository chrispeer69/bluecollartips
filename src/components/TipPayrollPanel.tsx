import { useState } from "react";
import { addDaysYmd, lastCompletedWeekStart, payWeekStart } from "@/lib/tip-payroll";

function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Pick a Saturday–Friday pay week and open the printable tip payroll report. */
export function TipPayrollPanel({ companyId }: { companyId: string }) {
  const [week, setWeek] = useState(() => lastCompletedWeekStart(localToday()));
  const open = (autoprint: boolean) => {
    const params = new URLSearchParams({ companyId, week, autoprint: String(autoprint) });
    window.open(`/print/tip-payroll?${params.toString()}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Each employee's share of card tips for one pay week (Saturday through Friday), ready to attach to payroll.
        Cash and other tips employees already received are listed for records but not added.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" onClick={() => setWeek((w) => addDaysYmd(w, -7))} className="rounded-md border border-border px-3 py-2" aria-label="Previous pay week">←</button>
        <label className="text-xs text-muted-foreground">
          Pay week containing
          <input
            id="tip-payroll-week"
            type="date"
            value={week}
            onChange={(e) => e.target.value && setWeek(payWeekStart(e.target.value))}
            className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button type="button" onClick={() => setWeek((w) => addDaysYmd(w, 7))} className="rounded-md border border-border px-3 py-2" aria-label="Next pay week">→</button>
        <div className="px-1 pb-2 font-medium">{label(week)} – {label(addDaysYmd(week, 6))}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => open(true)} className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground">Print tip payroll report</button>
        <button type="button" onClick={() => open(false)} className="rounded-md border border-border px-4 py-2">View on screen</button>
      </div>
    </div>
  );
}
