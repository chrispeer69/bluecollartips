import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = postgres(process.env.DATABASE_URL, { max: 1, ssl: process.env.NODE_ENV === "production" ? "require" : undefined });
await db`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const directory = new URL("../migrations/", import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
for (const name of files) {
  const applied = await db`select 1 from schema_migrations where name = ${name}`;
  if (applied.length) continue;
  const migration = await readFile(new URL(name, directory), "utf8");
  await db.begin(async (tx) => {
    await tx.unsafe(migration);
    await tx`insert into schema_migrations (name) values (${name})`;
  });
  console.log(`Applied ${name}`);
}
await db.end();
console.log("Database migration complete");
