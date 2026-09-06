import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { auth } from "@/auth/client";
import { getMyRoleContext } from "@/lib/auth.functions";
import { JoinWorkspacePanel } from "@/components/JoinWorkspacePanel";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Blue Collar Tips" },
      { name: "description", content: "Sign in to your Blue Collar Tips dashboard to view ratings, tips, and team activity for your towing or service company." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Dashboard — Blue Collar Tips" },
      { property: "og:description", content: "Your Blue Collar Tips dashboard for ratings, tips, and team activity." },
      { property: "og:url", content: "/dashboard" },
    ],
  }),
  component: DashboardRouter,
});

function DashboardRouter() {
  const navigate = useNavigate();
  const getRole = useServerFn(getMyRoleContext);
  const [status, setStatus] = useState<string>("Checking your account…");

  useEffect(() => {
    (async () => {
      const { data } = await auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
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
            ctx.pendingJoinCount
              ? "Your request was sent and is waiting for a company admin to approve it."
              : "Your account isn't linked to a company yet. Enter the invite code from your company admin below.",
          );
        }
      } catch (e: unknown) {
        setStatus(e instanceof Error ? e.message : "Could not load your account");
      }
    })();
  }, [getRole, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="w-full max-w-xl">
        <p className="text-sm text-muted-foreground">{status}</p>
        {!status.startsWith("Checking") && !status.includes("waiting for") && <div className="mt-5 text-left"><JoinWorkspacePanel /></div>}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={async () => {
              await auth.signOut();
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
