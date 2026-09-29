// Weekly tip payroll: what each employee earned in tips for one pay week
// (Saturday through Friday, company local time), for adding to payroll.
// Kept free of app aliases so tests can import it directly.
import type { Sql } from "postgres";
import { addDaysYmd, payWeekStart } from "./tip-payroll.ts";

export { addDaysYmd, payWeekStart, lastCompletedWeekStart } from "./tip-payroll.ts";

/** Pay weeks are counted in this time zone (companies have no zone setting yet). */
export const PAYROLL_TIME_ZONE = "America/New_York";

export type PayrollTip = {
  id: string;
  tippedAt: string;
  source: string;
  amountCents: number;
  employeeCents: number;
  customerName: string | null;
  jobId: string | null;
  refunded: boolean;
  disputed: boolean;
  note: string | null;
};

export type PayrollEmployee = {
  driverId: string | null;
  name: string;
  employeeId: string | null;
  /** Card tips collected through Blue Collar Tips: the employee share goes on payroll. */
  cardTips: PayrollTip[];
  cardCount: number;
  cardGrossCents: number;
  /** The amount to add to this employee's paycheck. */
  payrollCents: number;
  /** Card tips refunded or disputed this week: not paid. */
  heldTips: PayrollTip[];
  /** Cash / Venmo / etc. the employee already received directly: for records only. */
  otherTips: PayrollTip[];
  otherCents: number;
  /** Tip payouts already sent to the employee through the app during the week. */
  appPayoutCents: number;
};

export async function tipPayrollReport(sql: Sql, companyId: string, weekStart: string) {
  const start = payWeekStart(weekStart);
  const endExclusive = addDaysYmd(start, 7);

  const tips = await sql`
    SELECT t.id, t.driver_id, t.created_at, t.source::text AS source, t.amount_cents, t.driver_amount_cents,
           t.customer_name, t.note, t.refunded_at IS NOT NULL AS refunded, t.disputed,
           rc.external_job_id AS job_id
    FROM tips t
    LEFT JOIN ratings r ON r.id = t.rating_id
    LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
    WHERE t.company_id = ${companyId}
      AND t.created_at >= (${start}::date)::timestamp AT TIME ZONE ${PAYROLL_TIME_ZONE}
      AND t.created_at <  (${endExclusive}::date)::timestamp AT TIME ZONE ${PAYROLL_TIME_ZONE}
    ORDER BY t.created_at ASC`;

  const payouts = await sql`
    SELECT driver_id, COALESCE(SUM(amount_cents), 0)::int AS cents
    FROM payout_requests
    WHERE company_id = ${companyId} AND status = 'paid'
      AND paid_at >= (${start}::date)::timestamp AT TIME ZONE ${PAYROLL_TIME_ZONE}
      AND paid_at <  (${endExclusive}::date)::timestamp AT TIME ZONE ${PAYROLL_TIME_ZONE}
    GROUP BY driver_id`;

  const drivers = await sql`
    SELECT id, display_name, employee_id, status FROM drivers WHERE company_id = ${companyId}`;
  const driverInfo = new Map(drivers.map((d: any) => [d.id as string, { name: d.display_name as string, employeeId: (d.employee_id ?? null) as string | null }]));

  const byDriver = new Map<string, PayrollEmployee>();
  const entry = (driverId: string | null) => {
    const key = driverId ?? "__company__";
    let e = byDriver.get(key);
    if (!e) {
      const info = driverId ? driverInfo.get(driverId) : null;
      e = {
        driverId,
        name: driverId ? info?.name ?? "Former employee" : "Not assigned to an employee",
        employeeId: info?.employeeId ?? null,
        cardTips: [], cardCount: 0, cardGrossCents: 0, payrollCents: 0,
        heldTips: [], otherTips: [], otherCents: 0, appPayoutCents: 0,
      };
      byDriver.set(key, e);
    }
    return e;
  };

  for (const t of tips as any[]) {
    const tip: PayrollTip = {
      id: t.id,
      tippedAt: new Date(t.created_at).toISOString(),
      source: t.source,
      amountCents: Number(t.amount_cents),
      employeeCents: Number(t.driver_amount_cents),
      customerName: t.customer_name ?? null,
      jobId: t.job_id ?? null,
      refunded: Boolean(t.refunded),
      disputed: Boolean(t.disputed),
      note: t.note ?? null,
    };
    const e = entry(t.driver_id ?? null);
    if (tip.source !== "stripe") {
      e.otherTips.push(tip);
      e.otherCents += tip.amountCents;
    } else if (tip.refunded || tip.disputed) {
      e.heldTips.push(tip);
    } else {
      e.cardTips.push(tip);
      e.cardCount += 1;
      e.cardGrossCents += tip.amountCents;
      e.payrollCents += tip.employeeCents;
    }
  }
  for (const p of payouts as any[]) entry(p.driver_id).appPayoutCents += Number(p.cents);
  // Every active employee appears, even with no tips, so nobody is skipped at payroll.
  for (const d of drivers as any[]) if (d.status === "active") entry(d.id);

  const employees = [...byDriver.values()].sort((a, b) => {
    if (!a.driverId) return 1;
    if (!b.driverId) return -1;
    return a.name.localeCompare(b.name);
  });
  const totals = employees.reduce(
    (acc, e) => ({
      cardCount: acc.cardCount + e.cardCount,
      cardGrossCents: acc.cardGrossCents + e.cardGrossCents,
      payrollCents: acc.payrollCents + (e.driverId ? e.payrollCents : 0),
      otherCents: acc.otherCents + e.otherCents,
      heldCount: acc.heldCount + e.heldTips.length,
      appPayoutCents: acc.appPayoutCents + e.appPayoutCents,
    }),
    { cardCount: 0, cardGrossCents: 0, payrollCents: 0, otherCents: 0, heldCount: 0, appPayoutCents: 0 },
  );
  // Card tips with no employee: the company keeps them until someone assigns them.
  const unassigned = employees.find((e) => !e.driverId && e.cardTips.length > 0) ?? null;

  return {
    week: { start, end: addDaysYmd(start, 6) },
    employees: employees.filter((e) => e.driverId || e.cardTips.length || e.heldTips.length || e.otherTips.length),
    totals,
    unassignedCardTips: unassigned ? { count: unassigned.cardCount, grossCents: unassigned.cardGrossCents } : null,
  };
}
