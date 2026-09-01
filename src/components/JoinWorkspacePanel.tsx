import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { claimRole } from "@/lib/auth.functions";

export function JoinWorkspacePanel() {
  const claim = useServerFn(claimRole);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Join another workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Already have an account? Enter an invite code from a company admin to add that employee or admin workspace to this account.
      </p>
      <form
        className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          const code = inviteCode.trim();
          if (!code) return;
          setBusy(true);
          setError(null);
          try {
            await claim({ data: { inviteCode: code } });
            window.location.assign("/dashboard");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not join this workspace");
            setBusy(false);
          }
        }}
      >
        <label className="flex-1 text-sm">
          Invite code
          <input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase"
            placeholder="ABCD1234"
            maxLength={64}
            autoComplete="off"
            required
          />
        </label>
        <button
          disabled={busy || !inviteCode.trim()}
          className="self-end rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Joining…" : "Join workspace"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        Your email remains your login. The invite adds a separate company role and employee profile; it does not create another account.
      </p>
    </div>
  );
}
