import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Returns the signed-in user's roles + associated company info, and (if driver)
// the driver row. Used by the post-login router to send people to the right dashboard.
export const getMyRoleContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role, company_id");
    const { data: driver } = await supabase
      .from("drivers")
      .select("id, slug, status, company_id, display_name, photo_url, companies(slug, name, primary_color, secondary_color, logo_url)")
      .eq("user_id", userId)
      .maybeSingle();
    return { roles: roles ?? [], driver };
  });

// Bootstrap: redeem an invite code OR (if none + no super_admin exists) become super_admin.
export const claimRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ inviteCode: z.string().trim().max(64).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.inviteCode) {
      const { data: invite } = await supabaseAdmin
        .from("invites")
        .select("*")
        .eq("code", data.inviteCode)
        .maybeSingle();
      if (!invite) throw new Error("Invalid invite code");
      if (invite.used_at) throw new Error("Invite already used");
      if (invite.expires_at && new Date(invite.expires_at) < new Date())
        throw new Error("Invite expired");

      await supabaseAdmin.from("user_roles").insert({
        user_id: userId,
        company_id: invite.company_id,
        role: invite.role,
      });
      await supabaseAdmin
        .from("invites")
        .update({ used_at: new Date().toISOString(), used_by: userId })
        .eq("id", invite.id);

      // If invite was for a driver, link to an existing pending driver row by email
      if (invite.role === "driver" && invite.email) {
        await supabaseAdmin
          .from("drivers")
          .update({ user_id: userId, status: "active" })
          .eq("company_id", invite.company_id)
          .eq("email", invite.email)
          .is("user_id", null);
      }
      return { role: invite.role, companyId: invite.company_id };
    }

    // No code: bootstrap super_admin if none exists yet
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "super_admin");
    if (!count) {
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "super_admin" });
      return { role: "super_admin" as const, companyId: null };
    }
    throw new Error(
      "No invite code provided. Ask your company admin for one, or contact Blue Collar AI.",
    );
  });
