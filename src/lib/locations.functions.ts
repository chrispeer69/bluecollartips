import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

async function assertCompanyAdmin(userId: string, companyId: string) {
  const { db } = await import("@/db/client.server");
  const { data } = await db
    .from("user_roles")
    .select("role, company_id")
    .eq("user_id", userId);
  const ok = data?.some(
    (r) => r.role === "super_admin" || (r.role === "company_admin" && r.company_id === companyId),
  ) ?? false;
  if (!ok) throw new Error("Forbidden");
}

export const listLocations = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { data: rows } = await db
      .from("locations")
      .select("id, name, address, created_at")
      .eq("company_id", data.companyId)
      .order("name");
    return rows ?? [];
  });

export const createLocation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      name: z.string().trim().min(1).max(120),
      address: z.string().trim().max(300).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { error } = await db.from("locations").insert({
      company_id: data.companyId,
      name: data.name,
      address: data.address ?? null,
    });
    if (error) throw error;
    return { ok: true };
  });

export const deleteLocation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ locationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: loc } = await db.from("locations").select("company_id").eq("id", data.locationId).maybeSingle();
    if (!loc) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, loc.company_id);
    const { error } = await db.from("locations").delete().eq("id", data.locationId);
    if (error) throw error;
    return { ok: true };
  });

export const setDriverLocation = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      driverId: z.string().uuid(),
      locationId: z.string().uuid().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await import("@/db/client.server");
    const { data: drv } = await db.from("drivers").select("company_id").eq("id", data.driverId).maybeSingle();
    if (!drv) throw new Error("Not found");
    await assertCompanyAdmin(context.userId, drv.company_id);
    const { error } = await db
      .from("drivers")
      .update({ location_id: data.locationId })
      .eq("id", data.driverId);
    if (error) throw error;
    return { ok: true };
  });

export const updateReviewLinks = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      googleUrl: z.string().trim().url().max(500).optional().nullable(),
      yelpUrl: z.string().trim().url().max(500).optional().nullable(),
      facebookUrl: z.string().trim().url().max(500).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(context.userId, data.companyId);
    const { db } = await import("@/db/client.server");
    const { error } = await db
      .from("companies")
      .update({
        google_review_url: data.googleUrl ?? null,
        yelp_review_url: data.yelpUrl ?? null,
        facebook_review_url: data.facebookUrl ?? null,
      })
      .eq("id", data.companyId);
    if (error) throw error;
    return { ok: true };
  });