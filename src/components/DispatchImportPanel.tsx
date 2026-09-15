import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { applyRatingAttribution, previewRatingAttribution, type DispatchJob } from "@/lib/attribution.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Preview = Awaited<ReturnType<typeof previewRatingAttribution>>;

// Column names we recognise, case-insensitive. TowBook's Dispatching
// Analysis export is the primary target; generic CSVs work too.
const COLS: Record<keyof DispatchJob, string[]> = {
  jobId: ["call number", "call #", "call no", "job id", "job number", "job #", "invoice number", "purchase order"],
  driver: ["driver", "driver name", "employee", "technician", "tech"],
  customerName: ["customer name", "customer", "name"],
  customerPhone: ["customer phone", "phone", "customer phone number"],
  customerEmail: ["customer email", "email"],
  completedAt: ["completed", "completed at", "complete", "closed", "date completed", "date"],
};

function pickColumns(header: string[]) {
  const norm = header.map((h) => String(h ?? "").trim().toLowerCase());
  const idx: Partial<Record<keyof DispatchJob, number>> = {};
  for (const key of Object.keys(COLS) as (keyof DispatchJob)[]) {
    for (const alias of COLS[key]) {
      const i = norm.indexOf(alias);
      if (i >= 0) { idx[key] = i; break; }
    }
  }
  return idx;
}

function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86_400_000);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Parse .xlsx/.xls/.csv into job rows. Finds the header row automatically
 *  (TowBook puts a title and export timestamp above it). */
async function parseFile(file: File): Promise<{ jobs: DispatchJob[]; headerFound: string[] }> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /export|sheet1|data/i.test(n)) ?? wb.SheetNames[0];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const idx = pickColumns((rows[i] ?? []).map(String));
    if (idx.driver != null && (idx.jobId != null || idx.customerName != null || idx.customerPhone != null)) { headerRow = i; break; }
  }
  if (headerRow < 0) throw new Error("Couldn't find a header row with a Driver column plus a job number, customer name or phone.");
  const header = (rows[headerRow] ?? []).map((h) => String(h ?? ""));
  const idx = pickColumns(header);
  const cell = (r: unknown[], k: keyof DispatchJob) => (idx[k] == null ? null : r[idx[k]!]);
  const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);
  const jobs: DispatchJob[] = [];
  for (const r of rows.slice(headerRow + 1)) {
    if (!r || r.every((c) => c == null || c === "")) continue;
    const driver = str(cell(r, "driver"));
    if (!driver) continue;
    jobs.push({
      jobId: str(cell(r, "jobId")),
      driver,
      customerName: str(cell(r, "customerName")),
      customerPhone: str(cell(r, "customerPhone")),
      customerEmail: str(cell(r, "customerEmail")),
      completedAt: toIso(cell(r, "completedAt")),
    });
  }
  return { jobs, headerFound: header.filter(Boolean) };
}

const VIA_LABEL: Record<string, string> = {
  job: "job #", phone: "phone", email: "email", name: "name", dispatch: "dispatch name",
};

export function DispatchImportPanel({ companyId, onApplied }: { companyId: string; onApplied: () => void | Promise<void> }) {
  const preview = useServerFn(previewRatingAttribution);
  const apply = useServerFn(applyRatingAttribution);
  const [fileName, setFileName] = useState<string | null>(null);
  const [jobCount, setJobCount] = useState(0);
  const [data, setData] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null); setDone(null); setData(null);
    try {
      const { jobs } = await parseFile(file);
      if (!jobs.length) throw new Error("No jobs with a driver found in that file.");
      setFileName(file.name); setJobCount(jobs.length);
      const result = await preview({ data: { companyId, jobs } });
      setData(result);
      const initial: Record<string, string | null> = {};
      for (const r of result.rows) initial[r.ratingId] = r.employeeId;
      setChoice(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    } finally { setBusy(false); }
  }

  const assignments = useMemo(
    () => Object.entries(choice).filter(([, e]) => !!e).map(([ratingId, employeeId]) => ({ ratingId, employeeId: employeeId as string })),
    [choice],
  );

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Ratings that arrived without an employee show the company name. Upload your dispatch export (TowBook → Reports → Dispatching Analysis → Excel, or any CSV with a Driver column) and each rating is matched to its job by job number, then customer phone, email or name. Review the matches, fix any you disagree with, then apply.
    </p>
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      {busy ? "Working…" : "Choose export file"}
    </label>
    {fileName && <span className="ml-3 text-xs text-muted-foreground">{fileName} · {jobCount} jobs</span>}
    {error && <p className="text-sm text-destructive">{error}</p>}
    {done && <p className="text-sm text-emerald-700">{done}</p>}

    {data && (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span><b className="text-foreground">{data.totals.unattributed}</b> unattributed ratings</span>
          <span><b className="text-emerald-700">{data.totals.matched}</b> matched to an employee</span>
          <span><b className="text-amber-700">{data.totals.jobFoundNoEmployee}</b> job found, driver not an employee</span>
          <span><b className="text-foreground">{data.totals.noJob}</b> no job found</span>
        </div>
        {data.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to attribute — every rating already has an employee.</p> : <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Rated</th><th>Customer</th><th>Matched</th><th>Dispatch driver</th><th>Assign to</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.ratingId} className={choice[r.ratingId] ? "" : "text-muted-foreground"}>
                  <td className="whitespace-nowrap py-2">
                    <div><span className="text-secondary">{"★".repeat(r.stars)}</span> {new Date(r.ratedAt).toLocaleDateString()}</div>
                    {r.feedback && <div className="max-w-56 truncate text-xs text-muted-foreground" title={r.feedback}>{r.feedback}</div>}
                  </td>
                  <td>{r.customer ?? <span className="text-xs">no name</span>}</td>
                  <td className="text-xs">
                    {r.matchedVia ? <>via {VIA_LABEL[r.matchedVia]}{r.matchedJobId ? ` · #${r.matchedJobId}` : ""}</> : <span>no match{r.jobId ? ` (job #${r.jobId} not in file)` : ""}</span>}
                  </td>
                  <td className="text-xs">{r.driverName ?? "—"}</td>
                  <td>
                    <Select value={choice[r.ratingId] ?? "__none__"} onValueChange={(v) => setChoice((c) => ({ ...c, [r.ratingId]: v === "__none__" ? null : v }))}>
                      <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Leave as company</SelectItem>
                        {data.employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.status !== "active" ? ` (${e.status})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {data.rows.length > 0 && <div className="flex items-center gap-3">
          <button type="button" disabled={busy || assignments.length === 0} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const r = await apply({ data: { companyId, assignments } });
              setDone(`Attributed ${r.updated} rating${r.updated === 1 ? "" : "s"}.`);
              setData(null); setChoice({});
              await onApplied();
            } catch (err) { setError(err instanceof Error ? err.message : "Could not apply"); }
            finally { setBusy(false); }
          }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Apply {assignments.length} assignment{assignments.length === 1 ? "" : "s"}
          </button>
          <span className="text-xs text-muted-foreground">Rows set to "Leave as company" are skipped.</span>
        </div>}
      </div>
    )}
  </div>;
}
