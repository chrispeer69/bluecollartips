import { randomBytes } from "crypto";
import type { Sql, TransactionSql } from "postgres";
import { slugify } from "./constants.ts";
import type { CompanyImportResult, CompanyImportRow } from "./company-import.ts";

type Db = Sql | TransactionSql;

async function freeSlug(db: Db, name: string) {
  const base = slugify(name) || "company";
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [taken] = await db`SELECT 1 FROM companies WHERE slug = ${slug}`;
    if (!taken) return slug;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/** Create one company per row. Each row runs in its own savepoint so a bad
 *  row is reported without undoing the others. Companies whose name already
 *  exists are skipped, so re-running the same file is safe. No email is sent:
 *  owners who don't have an account get an invite link for the admin to send. */
export async function importCompanies(
  db: Sql,
  rows: CompanyImportRow[],
  createdBy: string,
  baseUrl: string,
): Promise<CompanyImportResult[]> {
  const base = baseUrl.replace(/\/$/, "");
  const results: CompanyImportResult[] = [];
  await db.begin(async (tx) => {
    for (const row of rows) {
      const email = row.adminEmail.trim().toLowerCase();
      const name = row.name.trim();
      try {
        const result = await tx.savepoint(async (sp): Promise<CompanyImportResult> => {
          const [existing] =
            await sp`SELECT slug FROM companies WHERE lower(name) = lower(${name}) LIMIT 1`;
          if (existing) {
            return {
              name,
              adminEmail: email,
              status: "exists",
              slug: existing.slug,
              inviteUrl: null,
              message: null,
            };
          }
          const slug = await freeSlug(sp, name);
          const [company] = await sp`
            INSERT INTO companies (name, slug, support_phone, support_email, google_review_url)
            VALUES (${name}, ${slug}, ${row.phone}, ${row.supportEmail}, ${row.googleReviewUrl})
            RETURNING id, slug`;
          const [user] = await sp`SELECT id FROM users WHERE lower(email) = ${email}`;
          if (user) {
            await sp`
              INSERT INTO user_roles (user_id, company_id, role) VALUES (${user.id}, ${company.id}, 'company_admin')
              ON CONFLICT DO NOTHING`;
            return {
              name,
              adminEmail: email,
              status: "attached",
              slug: company.slug,
              inviteUrl: null,
              message: null,
            };
          }
          const code = randomBytes(6).toString("hex").toUpperCase();
          await sp`
            INSERT INTO invites (company_id, code, role, email, created_by, expires_at)
            VALUES (${company.id}, ${code}, 'company_admin', ${email}, ${createdBy}, NOW() + INTERVAL '30 days')`;
          return {
            name,
            adminEmail: email,
            status: "created",
            slug: company.slug,
            inviteUrl: `${base}/join/${code}`,
            message: null,
          };
        });
        results.push(result);
      } catch (err) {
        results.push({
          name,
          adminEmail: email,
          status: "failed",
          slug: null,
          inviteUrl: null,
          message: err instanceof Error ? err.message : "Could not create company",
        });
      }
    }
  });
  return results;
}
