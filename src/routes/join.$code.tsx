import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { peekInvite } from "@/lib/invites.functions";

export const Route = createFileRoute("/join/$code")({
  head: () => ({ meta: [{ title: "Join — Blue Collar AI" }] }),
  component: JoinPage,
});

function JoinPage() {
  const { code } = useParams({ from: "/join/$code" });
  const peek = useServerFn(peekInvite);
  const navigate = useNavigate();
  const [state, setState] = useState<Awaited<ReturnType<typeof peekInvite>> | null>(null);

  useEffect(() => {
    peek({ data: { code } }).then(setState);
  }, [code, peek]);

  if (!state) {
    return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Loading invite…</div>;
  }

  if (!state.valid) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Invite unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.used ? "This invite has already been used." : "This invite is expired or invalid."}
          </p>
        </div>
      </div>
    );
  }

  const company = state.company;
  return (
    <div className="min-h-screen bg-background">
      <div
        className="px-6 py-10 text-white"
        style={{ background: company?.primary_color ?? "#0b2545" }}
      >
        <div className="mx-auto max-w-lg text-center">
          {company?.logo_url && <img src={company.logo_url} alt={company.name} className="mx-auto h-14" />}
          <h1 className="display mt-4 text-3xl font-bold">Welcome to {company?.name}</h1>
          <p className="mt-2 opacity-90">
            You've been invited to join as a <span className="font-semibold uppercase">{state.role.replace("_", " ")}</span>.
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-md p-6">
        <button
          className="w-full rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground"
          onClick={() => navigate({ to: "/auth", search: { invite: code, email: state.email ?? undefined } })}
        >
          Create your account
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Already signed up? You can also sign in and enter invite code <span className="font-mono">{code}</span> from the dashboard.
        </p>
      </div>
    </div>
  );
}