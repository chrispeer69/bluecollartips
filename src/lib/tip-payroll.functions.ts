import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

/** Weekly tip payroll report (Saturday–Friday) for a company's admins. */
export const getTipPayrollReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      // Any date in the pay week; the report snaps to that week's Saturday.
      weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db, sql } = await import("@/db/client.server");
    const { data: roles } = await db.from("user_roles").select("role, company_id").eq("user_id", context.userId);
    const ok = roles?.some((r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === data.companyId));
    if (!ok) throw new Error("Forbidden");

    const [company] = await sql()`
      SELECT id, name, logo_url, primary_color, driver_pct, company_pct FROM companies WHERE id = ${data.companyId}`;
    if (!company) throw new Error("Not found");
    const { tipPayrollReport } = await import("@/lib/tip-payroll.server");
    const report = await tipPayrollReport(sql(), data.companyId, data.weekOf);
    // Card-tip split in effect (see apply_tip_split): employee 90%, platform 10%.
    const companyPct = Math.min(10, Math.max(0, Number(company.company_pct ?? 0)));
    return {
      company: {
        name: company.name as string,
        logo_url: (company.logo_url ?? null) as string | null,
        primary_color: (company.primary_color ?? null) as string | null,
        employeePct: 90 - companyPct,
        companyPct,
      },
      ...report,
    };
  });
