// Shared (client + server) pieces of the bulk company import.

export const MAX_IMPORT_ROWS = 500;

export type CompanyImportRow = {
  name: string;
  adminEmail: string;
  phone: string | null;
  supportEmail: string | null;
  googleReviewUrl: string | null;
};

export type ParsedImportRow = CompanyImportRow & { line: number; problems: string[] };

export type CompanyImportResult = {
  name: string;
  adminEmail: string;
  status: "created" | "attached" | "exists" | "failed";
  slug: string | null;
  inviteUrl: string | null;
  message: string | null;
};

// Column names we recognise, case-insensitive.
const COLS: Record<keyof CompanyImportRow, string[]> = {
  name: ["company name", "company", "business name", "business", "name"],
  adminEmail: ["owner email", "admin email", "email", "owner e-mail", "contact email"],
  phone: ["phone", "company phone", "support phone", "phone number", "owner phone"],
  supportEmail: ["support email", "customer support email"],
  googleReviewUrl: ["google review url", "google review link", "google reviews", "google"],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const TEMPLATE_CSV =
  "Company name,Owner email,Phone,Support email,Google review link\n" +
  "Example Towing LLC,owner@exampletowing.com,(614) 555-0100,help@exampletowing.com,https://g.page/r/example/review\n";

function pickColumns(header: string[]) {
  const norm = header.map((h) =>
    String(h ?? "")
      .trim()
      .toLowerCase(),
  );
  const idx: Partial<Record<keyof CompanyImportRow, number>> = {};
  for (const key of Object.keys(COLS) as (keyof CompanyImportRow)[]) {
    for (const alias of COLS[key]) {
      const i = norm.indexOf(alias);
      if (i >= 0 && !Object.values(idx).includes(i)) {
        idx[key] = i;
        break;
      }
    }
  }
  return idx;
}

/** Turn spreadsheet rows (first non-empty row is the header) into import rows
 *  with per-row problems. Rows with problems are shown but never imported. */
export function parseCompanyRows(rows: unknown[][]): { rows: ParsedImportRow[]; header: string[] } {
  const start = rows.findIndex((r) => r?.some((c) => c != null && String(c).trim() !== ""));
  if (start < 0) throw new Error("The file is empty.");
  const header = (rows[start] ?? []).map((h) => String(h ?? "").trim());
  const idx = pickColumns(header);
  if (idx.name == null || idx.adminEmail == null) {
    throw new Error(
      'The first row must include a "Company name" column and an "Owner email" column.',
    );
  }
  const str = (r: unknown[], k: keyof CompanyImportRow) => {
    const v = idx[k] == null ? null : r[idx[k]!];
    const s = v == null ? "" : String(v).trim();
    return s || null;
  };
  const seen = new Set<string>();
  const out: ParsedImportRow[] = [];
  rows.slice(start + 1).forEach((r, i) => {
    if (!r || r.every((c) => c == null || String(c).trim() === "")) return;
    const row: ParsedImportRow = {
      line: start + i + 2,
      name: str(r, "name") ?? "",
      adminEmail: (str(r, "adminEmail") ?? "").toLowerCase(),
      phone: str(r, "phone"),
      supportEmail: str(r, "supportEmail")?.toLowerCase() ?? null,
      googleReviewUrl: str(r, "googleReviewUrl"),
      problems: [],
    };
    if (row.name.length < 2) row.problems.push("Company name is missing");
    if (row.name.length > 120) row.problems.push("Company name is too long");
    if (!EMAIL.test(row.adminEmail)) row.problems.push("Owner email is missing or invalid");
    if (row.supportEmail && !EMAIL.test(row.supportEmail))
      row.problems.push("Support email is invalid");
    if (row.googleReviewUrl && !/^https?:\/\//i.test(row.googleReviewUrl)) {
      row.problems.push("Google review link must start with http");
    }
    const key = row.name.toLowerCase();
    if (key && seen.has(key)) row.problems.push("Same company name appears earlier in the file");
    seen.add(key);
    out.push(row);
  });
  if (out.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `Import up to ${MAX_IMPORT_ROWS} companies at a time (this file has ${out.length}).`,
    );
  }
  return { rows: out, header: header.filter(Boolean) };
}

const STATUS_LABEL: Record<CompanyImportResult["status"], string> = {
  created: "Created — send invite link",
  attached: "Created — owner already has an account",
  exists: "Skipped — company already exists",
  failed: "Failed",
};

function csvCell(v: string | null) {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of results for the admin to download and send invites from. */
export function importResultsCsv(results: CompanyImportResult[], baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  const lines = [
    ["Company name", "Owner email", "Result", "Invite link", "Company page", "Note"].join(","),
  ];
  for (const r of results) {
    lines.push(
      [
        r.name,
        r.adminEmail,
        STATUS_LABEL[r.status],
        r.inviteUrl,
        r.slug ? `${base}/${r.slug}` : null,
        r.message,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function importStatusLabel(status: CompanyImportResult["status"]) {
  return STATUS_LABEL[status];
}
