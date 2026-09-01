import postgres from "postgres";

type Row = Record<string, any>;
type Filter = { column: string; op: string; value: any };

let client: ReturnType<typeof postgres> | undefined;

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  client ??= postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
    transform: { undefined: null },
  });
  return client;
}

const identifiers = /^[a-z_][a-z0-9_]*$/i;
function safe(value: string) {
  if (!identifiers.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

const relations: Record<string, Record<string, { table: string; local: string; remote: string; many?: boolean }>> = {
  drivers: { companies: { table: "companies", local: "company_id", remote: "id" }, locations: { table: "locations", local: "location_id", remote: "id" } },
  ratings: { drivers: { table: "drivers", local: "driver_id", remote: "id" }, companies: { table: "companies", local: "company_id", remote: "id" } },
  tips: { drivers: { table: "drivers", local: "driver_id", remote: "id" }, companies: { table: "companies", local: "company_id", remote: "id" }, ratings: { table: "ratings", local: "rating_id", remote: "id" } },
  user_roles: { companies: { table: "companies", local: "company_id", remote: "id" } },
};

function splitSelect(value: string) {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (value[i] === "," && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

class Query implements PromiseLike<any> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private values: Row | Row[] | undefined;
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private rowLimit?: number;
  private returning = false;
  private countOnly = false;

  constructor(private table: string) { safe(table); }
  select(columns = "*", options?: { count?: string; head?: boolean }) { this.columns = columns; this.returning = this.action !== "select"; this.countOnly = !!options?.head; return this; }
  insert(values: Row | Row[]) { this.action = "insert"; this.values = values; return this; }
  update(values: Row) { this.action = "update"; this.values = values; return this; }
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.action = "upsert"; this.values = values; if (options?.onConflict) (this as any).conflict = options.onConflict; (this as any).ignoreDuplicates = options?.ignoreDuplicates; return this; }
  delete() { this.action = "delete"; return this; }
  eq(column: string, value: any) { this.filters.push({ column: safe(column), op: "=", value }); return this; }
  neq(column: string, value: any) { this.filters.push({ column: safe(column), op: "!=", value }); return this; }
  gt(column: string, value: any) { this.filters.push({ column: safe(column), op: ">", value }); return this; }
  gte(column: string, value: any) { this.filters.push({ column: safe(column), op: ">=", value }); return this; }
  lt(column: string, value: any) { this.filters.push({ column: safe(column), op: "<", value }); return this; }
  lte(column: string, value: any) { this.filters.push({ column: safe(column), op: "<=", value }); return this; }
  is(column: string, value: any) { this.filters.push({ column: safe(column), op: value === null ? "is" : "=", value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ column: safe(column), op: "in", value }); return this; }
  ilike(column: string, value: string) { this.filters.push({ column: safe(column), op: "ilike", value }); return this; }
  or(expression: string) { (this as any).orExpression = expression; return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column: safe(column), ascending: options?.ascending !== false }); return this; }
  limit(value: number) { this.rowLimit = value; return this; }
  async single() { const result = await this.execute(); if (!result.data?.[0]) return { data: null, error: { message: "Row not found" } }; return { data: result.data[0], error: result.error }; }
  async maybeSingle() { const result = await this.execute(); return { data: result.data?.[0] ?? null, error: result.error }; }
  then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private where(db: ReturnType<typeof sql>) {
    if (!this.filters.length) return db``;
    const parts = this.filters.map((f) => {
      const col = db(safe(f.column));
      if (f.op === "is") return db`${col} is null`;
      if (f.op === "in") return db`${col} in ${db(f.value)}`;
      if (f.op === "ilike") return db`${col} ilike ${f.value}`;
      if (f.op === "=") return db`${col} = ${f.value}`;
      if (f.op === "!=") return db`${col} != ${f.value}`;
      if (f.op === ">") return db`${col} > ${f.value}`;
      if (f.op === ">=") return db`${col} >= ${f.value}`;
      if (f.op === "<") return db`${col} < ${f.value}`;
      return db`${col} <= ${f.value}`;
    });
    const combined = parts.reduce((a, b) => db`${a} and ${b}`);
    const extra = (this as any).orExpression === "disputed.eq.true,refunded_at.not.is.null"
      ? db`(disputed_at is not null or refunded_at is not null)` : null;
    return extra ? db`where ${combined} and ${extra}` : db`where ${combined}`;
  }

  private async addRelations(rows: Row[]) {
    const nested = splitSelect(this.columns).filter((c) => c.includes("("));
    for (const spec of nested) {
      const match = spec.match(/^(\w+)(?:!\w+)?\((.*)\)$/s);
      if (!match) continue;
      const rel = relations[this.table]?.[match[1]];
      if (!rel) continue;
      for (const row of rows) {
        if (row[rel.local] == null) { row[match[1]] = null; continue; }
        const db = sql();
        const selected = match[2] === "*" ? "*" : splitSelect(match[2]).filter((x) => !x.includes("(")).map(safe);
        const found = await db`select ${selected === "*" ? db`*` : db(selected as string[])} from ${db(rel.table)} where ${db(rel.remote)} = ${row[rel.local]} limit 1`;
        row[match[1]] = found[0] ?? null;
      }
    }
    return rows;
  }

  private async execute() {
    try {
      const db = sql();
      const table = db(this.table);
      const where = this.where(db);
      let rows: any[] = [];
      if (this.action === "select") {
        if (this.countOnly) {
          const result = await db`select count(*)::int as count from ${table} ${where}`;
          return { data: null, error: null, count: result[0].count };
        }
        const plain = splitSelect(this.columns).filter((c) => !c.includes("("));
        const cols = plain.includes("*") || !plain.length ? db`*` : db(plain.map((c) => safe(c.split(":").pop()!)));
        const order = this.orders.length ? db`order by ${this.orders.map((o) => db`${db(o.column)} ${o.ascending ? db`asc` : db`desc`}`).reduce((a, b) => db`${a}, ${b}`)}` : db``;
        const limit = this.rowLimit ? db`limit ${this.rowLimit}` : db``;
        rows = await db`select ${cols} from ${table} ${where} ${order} ${limit}`;
        rows = await this.addRelations([...rows]);
      } else if (this.action === "insert" || this.action === "upsert") {
        const values = Array.isArray(this.values) ? this.values : [this.values!];
        if (this.action === "upsert") {
          const conflict = String((this as any).conflict ?? "id").split(",").map((part) => safe(part.trim()));
          const keys = Object.keys(values[0]).filter((k) => !conflict.includes(k)).map(safe);
          rows = (this as any).ignoreDuplicates
            ? await db`insert into ${table} ${db(values)} on conflict (${db(conflict)}) do nothing returning *`
            : await db`insert into ${table} ${db(values)} on conflict (${db(conflict)}) do update set ${db(values[0], keys)} returning *`;
        } else rows = await db`insert into ${table} ${db(values)} returning *`;
      } else if (this.action === "update") rows = await db`update ${table} set ${db(this.values!)} ${where} returning *`;
      else rows = await db`delete from ${table} ${where} returning *`;
      return { data: rows, error: null, count: rows.length };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) }, count: null };
    }
  }
}

export const db = {
  from(table: string) { return new Query(table); },
};
