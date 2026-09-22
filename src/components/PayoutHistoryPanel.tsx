import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDriverPayoutHistory } from "@/lib/wallet.functions";
import { payoutMethodLabel } from "@/components/PayoutDestinationForm";
import { dollars } from "@/lib/constants";

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-amber-50 text-amber-800 border-amber-200",
  processing: "bg-amber-50 text-amber-800 border-amber-200",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Approved — sending",
  processing: "Sending",
  paid: "Paid",
  rejected: "Declined",
  cancelled: "Cancelled",
};

/** An employee's withdrawal history, so they can see where their money is. */
export function PayoutHistoryPanel({ driverId }: { driverId: string }) {
  const fetchHistory = useServerFn(getDriverPayoutHistory);
  const [data, setData] = useState<Awaited<ReturnType<typeof getDriverPayoutHistory>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHistory({ data: { driverId } })
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load payouts."); });
    return () => { cancelled = true; };
  }, [fetchHistory, driverId]);

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading payouts…</p>;
  if (!data.requests.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No withdrawals yet. When you request one, it shows up here with its status.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid to you</div>
          <div className="mt-1 text-2xl font-semibold">{dollars(data.paidCents)}</div>
        </div>
        <div className="rounded-xl border border-border p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">In progress</div>
          <div className="mt-1 text-2xl font-semibold">{dollars(data.pendingCents)}</div>
        </div>
      </div>

      <ul className="space-y-3">
        {data.requests.map((r) => (
          <li key={r.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold">{dollars(Number(r.amount_cents))}</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? "border-border text-muted-foreground"}`}>
                {STATUS_LABELS[r.status] ?? r.status}
              </span>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>Requested</dt>
                <dd>{new Date(r.requested_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</dd>
              </div>
              {r.paid_at && (
                <div className="flex justify-between gap-3">
                  <dt>Paid</dt>
                  <dd>{new Date(r.paid_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</dd>
                </div>
              )}
              {r.payout_method && (
                <div className="flex justify-between gap-3">
                  <dt>Sent to</dt>
                  <dd className="text-right">
                    {payoutMethodLabel(r.payout_method)}
                    {r.payout_account_name ? ` · ${r.payout_account_name}` : ""}
                  </dd>
                </div>
              )}
              {r.payment_reference && (
                <div className="flex justify-between gap-3">
                  <dt>Reference</dt>
                  <dd className="break-all text-right">{r.payment_reference}</dd>
                </div>
              )}
            </dl>
            {r.admin_note && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">{r.admin_note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
