import { createFileRoute } from "@tanstack/react-router";

// One-shot bootstrap. Delete this file after use.
export const Route = createFileRoute("/api/public/bootstrap-super-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email, password, full_name } = (await request.json()) as {
          email: string;
          password: string;
          full_name?: string;
        };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Try to find existing user
        let userId: string | undefined;
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (existing) {
          userId = existing.id;
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            password,
            email_confirm: true,
            user_metadata: { full_name: full_name ?? "Super Admin" },
          });
        } else {
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: full_name ?? "Super Admin" },
          });
          if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          userId = data.user?.id;
        }
        if (!userId) return new Response(JSON.stringify({ error: "no user id" }), { status: 500 });

        await supabaseAdmin.from("profiles").upsert({ id: userId, full_name: full_name ?? "Super Admin" });

        const { data: existingRole } = await supabaseAdmin
          .from("user_roles")
          .select("id")
          .eq("user_id", userId)
          .eq("role", "super_admin")
          .maybeSingle();
        if (!existingRole) {
          await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "super_admin" });
        }

        return new Response(JSON.stringify({ ok: true, userId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});