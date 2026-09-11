import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { leaveDriverWorkspace } from "@/lib/invites.functions";

export function LeaveWorkspacePanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const leaveWorkspace = useServerFn(leaveDriverWorkspace);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-destructive/20 bg-card p-5">
      <h2 className="text-base font-semibold">Leave workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Remove your employee access to {companyName}. Existing ratings, tips, payout requests, and payment records will remain with the workspace.
      </p>
      {!confirming ? (
        <button type="button" onClick={() => { setConfirming(true); setError(null); }} className="mt-4 rounded-md border border-destructive/30 px-4 py-2 text-sm text-destructive">
          Leave workspace
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
          <p className="text-sm font-medium">Are you sure you want to leave {companyName}?</p>
          <p className="mt-1 text-xs text-muted-foreground">You will immediately lose access. A company admin must invite you again if you need to rejoin.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await leaveWorkspace({ data: { companyId } });
                  localStorage.removeItem("employeeWorkspaceId");
                  window.location.assign("/dashboard");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not leave workspace");
                  setBusy(false);
                }
              }}
              className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50"
            >
              {busy ? "Leaving…" : "Yes, leave workspace"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-border bg-card px-4 py-2 text-sm disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
