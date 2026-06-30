import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyRoleContext } from "@/lib/auth.functions";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Dashboard — Blue Collar AI" }] }),
  component: DashboardRouter,
});

function DashboardRouter() {
  const navigate = useNavigate();
  const getRole = useServerFn(getMyRoleContext);
  const [status, setStatus] = useState<string>("Checking your account…");

  useEffect(() => {
    (async () => {
      let { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (import.meta.env.DEV) {
          // Wait briefly for dev auto-login to establish a session.
          const { ensureDevSession } = await import("@/lib/dev-auth");
          await ensureDevSession();
          for (let i = 0; i < 20 && !data.session; i++) {
            await new Promise((r) => setTimeout(r, 150));
            data = (await supabase.auth.getSession()).data;
          }
        }
        if (!data.session) {
          navigate({ to: "/auth" });
          return;
        }
      }
      try {
        const ctx = await getRole();
        const isSuper = ctx.roles.some((r) => r.role === "super_admin");
        const isAdmin = ctx.roles.some((r) => r.role === "company_admin");
        if (isSuper || isAdmin) {
          navigate({ to: "/dashboard/admin" });
        } else if (ctx.driver) {
          navigate({ to: "/dashboard/driver" });
        } else {
          setStatus(
            "Your account isn't linked to a company yet. Ask your company admin to send you an invite code, then sign out and sign up with it.",
          );
        }
      } catch (e: unknown) {
        setStatus(e instanceof Error ? e.message : "Could not load your account");
      }
    })();
  }, [getRole, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm text-muted-foreground">{status}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            Sign out
          </button>
          <Link to="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}