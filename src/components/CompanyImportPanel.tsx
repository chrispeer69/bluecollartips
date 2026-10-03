import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { importCompanies } from "@/lib/platform.functions";
import {
  TEMPLATE_CSV,
  importResultsCsv,
  importStatusLabel,
  parseCompanyRows,
  type CompanyImportResult,
  type ParsedImportRow,
} from "@/lib/company-import";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function readRows(file: File): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: null,
  });
}

/** Platform admin: create many companies from a CSV/Excel file and download
 *  the owners' invite links. */
export function CompanyImportPanel({ onDone }: { onDone: () => Promise<void> | void }) {
  const run = useServerFn(importCompanies);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[] | null>(null);
  const [results, setResults] = useState<{ list: CompanyImportResult[]; baseUrl: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = rows?.filter((r) => r.problems.length === 0) ?? [];
  const blocked = (rows?.length ?? 0) - ready.length;

  async function onFile(file: File | undefined) {
    setError(null);
    setResults(null);
    setRows(null);
    if (!file) return;
    setFileName(file.name);
    try {
      setRows(parseCompanyRows(await readRows(file)).rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  async function onImport() {
    setBusy(true);
    setError(null);
    try {
      const r = await run({
        data: {
          rows: ready.map(({ name, adminEmail, phone, supportEmail, googleReviewUrl }) => ({
            name,
            adminEmail,
            phone,
            supportEmail,
            googleReviewUrl,
          })),
        },
      });
      setResults({ list: r.results, baseUrl: r.baseUrl });
      setRows(null);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const counts = results
    ? results.list.reduce<Record<string, number>>(
        (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
        {},
      )
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload a CSV or Excel file with one company per row. Required columns: <b>Company name</b>{" "}
        and <b>Owner email</b>. Optional: <b>Phone</b>, <b>Support email</b>,{" "}
        <b>Google review link</b>. Each owner gets an invite link to set up their account — nothing
        is emailed, you download the links and send them.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Choose file
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => download("company-import-template.csv", TEMPLATE_CSV)}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Download template
        </button>
        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {rows && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <b>{ready.length}</b> ready to import
              {blocked > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {blocked} with problems (will be skipped — fix the file and re-upload to include
                  them)
                </span>
              )}
            </p>
            <button
              type="button"
              disabled={busy || ready.length === 0}
              onClick={onImport}
              className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Creating companies…"
                : `Create ${ready.length} ${ready.length === 1 ? "company" : "companies"}`}
            </button>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Owner email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                    <td className="px-3 py-2 font-medium">{r.name || "—"}</td>
                    <td className="px-3 py-2">{r.adminEmail || "—"}</td>
                    <td className="px-3 py-2">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.problems.length ? (
                        <span className="text-destructive">{r.problems.join("; ")}</span>
                      ) : (
                        <span className="text-emerald-700">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results && counts && (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <b>{(counts.created ?? 0) + (counts.attached ?? 0)}</b> companies created
              {counts.created ? ` · ${counts.created} invite links to send` : ""}
              {counts.attached
                ? ` · ${counts.attached} owners already had an account and were added directly`
                : ""}
              {counts.exists ? ` · ${counts.exists} skipped (already exist)` : ""}
              {counts.failed ? ` · ${counts.failed} failed` : ""}
            </p>
            <button
              type="button"
              onClick={() =>
                download(
                  `company-invites-${new Date().toISOString().slice(0, 10)}.csv`,
                  importResultsCsv(results.list, results.baseUrl),
                )
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download invite links (CSV)
            </button>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Owner email</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Invite link</th>
                </tr>
              </thead>
              <tbody>
                {results.list.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">{r.adminEmail}</td>
                    <td className={`px-3 py-2 ${r.status === "failed" ? "text-destructive" : ""}`}>
                      {importStatusLabel(r.status)}
                      {r.message ? ` — ${r.message}` : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{r.inviteUrl ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Invite links work for 30 days. Each owner signs up with the email listed and lands in
            their company dashboard.
          </p>
        </div>
      )}
    </div>
  );
}
