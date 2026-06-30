import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// DEV ONLY: list all tenants for the impersonation switcher. Gated to super_admin.
export const listDevTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isSuper = roles?.some((r) => r.role === "super_admin") ?? false;
    if (!isSuper) return { isSuper: false, companies: [] as { id: string; name: string; slug: string }[] };
    const { data: companies } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .order("name");
    return { isSuper: true, companies: companies ?? [] };
  });

// DEV ONLY: ensure "Roadside Towing" tenant #1 exists, return its id.
export const ensureRoadsideTowing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isSuper = roles?.some((r) => r.role === "super_admin") ?? false;
    if (!isSuper) throw new Error("Not authorized");
    const { data: existing } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("slug", "roadside-towing")
      .maybeSingle();
    if (existing) return { id: existing.id, created: false };
    const { data: created, error } = await supabaseAdmin
      .from("companies")
      .insert({
        name: "Roadside Towing",
        slug: "roadside-towing",
        primary_color: "#ea580c",
        secondary_color: "#0f172a",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: created.id, created: true };
  });

// DEV ONLY: return first company slug + first driver slug for quick public-page nav.
export const getDevSampleDriver = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isSuper = roles?.some((r) => r.role === "super_admin") ?? false;
    if (!isSuper) return null;
    const { data: driver } = await supabaseAdmin
      .from("drivers")
      .select("slug, companies!inner(slug)")
      .limit(1)
      .maybeSingle();
    if (!driver) return null;
    const companies = driver.companies as unknown as { slug?: string } | { slug?: string }[] | null;
    const companySlug = Array.isArray(companies) ? companies[0]?.slug : companies?.slug;
    const driverSlug = driver.slug as string | undefined;
    if (!companySlug || !driverSlug) return null;
    return { companySlug, driverSlug };
  });