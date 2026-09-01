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
  throw new Error("Employee workspace integration tests only run against a local database");
}

const db = postgres(databaseUrl, { max: 1 });
const rollback = Symbol("rollback");

test("employee sees both own company workspaces but cannot access another employee", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx`
        insert into users (email, full_name)
        values (${`workspace-${suffix}@example.test`}, 'Workspace Tester') returning id
      `;
      const companies = [];
      for (const number of [1, 2, 3]) {
        const [company] = await tx`
          insert into companies (name, slug)
          values (${`Workspace Company ${number}`}, ${`workspace-company-${number}-${suffix}`}) returning id
        `;
        companies.push(company);
      }
      for (const [index, company] of companies.slice(0, 2).entries()) {
        await tx`
          insert into drivers (company_id, user_id, display_name, slug, status)
          values (${company.id}, ${user.id}, 'Workspace Tester', ${`workspace-tester-${index}`}, 'active')
        `;
      }
      const [unrelated] = await tx`
        insert into drivers (company_id, display_name, slug, status)
        values (${companies[2].id}, 'Unrelated Employee', 'unrelated-employee', 'active') returning id
      `;

      const own = await tx`
        select id, company_id from drivers where user_id = ${user.id} order by company_id
      `;
      assert.equal(own.length, 2, "both company profiles are selectable");
      assert.notEqual(own[0].company_id, own[1].company_id, "workspaces belong to different companies");

      const publicPage = await tx`
        select d.id
        from drivers d join companies c on c.id = d.company_id
        where c.slug = ${`workspace-company-2-${suffix}`}
          and d.slug = 'workspace-tester-1'
          and d.status = 'active'
      `;
      assert.equal(publicPage.length, 1, "company slug plus employee slug resolves exactly one QR page");

      const requestedOwn = await tx`
        select exists(
          select 1 from drivers where id = ${own[1].id} and user_id = ${user.id}
        ) as allowed
      `;
      assert.equal(requestedOwn[0].allowed, true);

      const requestedOther = await tx`
        select exists(
          select 1 from drivers where id = ${unrelated.id} and user_id = ${user.id}
        ) as allowed
      `;
      assert.equal(requestedOther[0].allowed, false, "unrelated employee profile is denied");

      await assert.rejects(
        tx.savepoint((savepoint) => savepoint`
          insert into drivers (company_id, user_id, display_name, slug, status)
          values (${companies[0].id}, ${user.id}, 'Duplicate', ${`duplicate-${suffix}`}, 'active')
        `),
        /drivers_user_company_unique/,
        "a user cannot have duplicate profiles in one company",
      );

      await assert.rejects(
        tx.savepoint((savepoint) => savepoint`
          insert into users (email, full_name)
          values (${`workspace-${suffix}@example.test`}, 'Same Email')
        `),
        /users_email_key/,
        "login email remains globally unique",
      );

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test.after(async () => {
  await db.end();
});
