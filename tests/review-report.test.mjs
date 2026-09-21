import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Review report integration tests only run against a local database");
}

const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");

// Mirrors the filter clause in src/lib/reviews.functions.ts: every filter is
// optional and expressed as `param IS NULL OR column <op> param`.
function report(tx, { companyId, driverId, from, to, minStars, feedbackOnly }) {
  return tx`
    SELECT r.id, r.stars, r.feedback, r.customer_name, r.driver_id, r.created_at,
           d.display_name AS driver_name
    FROM ratings r
    LEFT JOIN drivers d ON d.id = r.driver_id
    WHERE r.company_id = ${companyId}
      AND (${driverId ?? null}::uuid IS NULL OR r.driver_id = ${driverId ?? null}::uuid)
      AND (${from ?? null}::timestamptz IS NULL OR r.created_at >= ${from ?? null}::timestamptz)
      AND (${to ?? null}::timestamptz IS NULL OR r.created_at <= ${to ?? null}::timestamptz)
      AND (${minStars ?? null}::int IS NULL OR r.stars >= ${minStars ?? null}::int)
      AND (${feedbackOnly ? true : false} = false OR NULLIF(BTRIM(r.feedback), '') IS NOT NULL)
    ORDER BY r.created_at DESC
    LIMIT 2000
  `;
}

test("review report: optional employee, date range, rating and comment filters", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [company] = await tx`
        insert into companies (name, slug) values (${`Report Co ${suffix}`}, ${`report-co-${suffix}`}) returning id
      `;
      const [other] = await tx`
        insert into companies (name, slug) values (${`Other Co ${suffix}`}, ${`other-co-${suffix}`}) returning id
      `;
      const [ana] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Ana Driver', ${`ana-${suffix}`}, 'active') returning id`;
      const [ben] = await tx`insert into drivers (company_id, display_name, slug, status) values (${company.id}, 'Ben Driver', ${`ben-${suffix}`}, 'active') returning id`;
      const [outsider] = await tx`insert into drivers (company_id, display_name, slug, status) values (${other.id}, 'Zed Outsider', ${`zed-${suffix}`}, 'active') returning id`;

      const day = (n) => new Date(Date.UTC(2026, 8, n, 12)); // Sep 2026
      await tx`
        insert into ratings (company_id, driver_id, stars, feedback, customer_name, created_at) values
          (${company.id}, ${ana.id}, 5, 'Fast and friendly', 'Pat', ${day(1)}),
          (${company.id}, ${ana.id}, 4, '   ', null, ${day(8)}),
          (${company.id}, ${ana.id}, 2, 'Late', 'Sam', ${day(15)}),
          (${company.id}, ${ben.id}, 5, null, null, ${day(10)}),
          (${company.id}, null, 3, 'Dispatcher was helpful', 'Lee', ${day(12)}),
          (${other.id}, ${outsider.id}, 5, 'Wrong company', null, ${day(9)})
      `;

      // No filters: everything for this company, newest first, including the
      // unattributed company review; nothing from the other tenant.
      const all = await report(tx, { companyId: company.id });
      assert.equal(all.length, 5);
      assert.deepEqual(all.map((r) => r.stars), [2, 3, 5, 4, 5]);
      assert.ok(all.every((r) => r.driver_name !== "Zed Outsider"));
      assert.equal(all.find((r) => r.driver_id === null).driver_name, null);

      // One employee.
      const anaOnly = await report(tx, { companyId: company.id, driverId: ana.id });
      assert.deepEqual(anaOnly.map((r) => r.stars), [2, 4, 5]);
      assert.ok(anaOnly.every((r) => r.driver_name === "Ana Driver"));

      // Date window is inclusive on both ends.
      const week = await report(tx, {
        companyId: company.id,
        from: day(8).toISOString(),
        to: day(12).toISOString(),
      });
      assert.deepEqual(week.map((r) => r.stars), [3, 5, 4]);

      // Minimum rating.
      const positive = await report(tx, { companyId: company.id, minStars: 4 });
      assert.deepEqual(positive.map((r) => r.stars), [5, 4, 5]);

      // Written comments only: whitespace-only feedback does not count.
      const commented = await report(tx, { companyId: company.id, feedbackOnly: true });
      assert.deepEqual(commented.map((r) => r.feedback), ["Late", "Dispatcher was helpful", "Fast and friendly"]);

      // Filters compose.
      const combo = await report(tx, { companyId: company.id, driverId: ana.id, minStars: 4, feedbackOnly: true });
      assert.deepEqual(combo.map((r) => r.feedback), ["Fast and friendly"]);

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => { await db.end(); });
