import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PayoutMethod =
  "bank_transfer" | "cash_app" | "venmo" | "zelle" | "paypal" | "check" | "other";
export type PayoutDestination = { method: PayoutMethod; accountName: string; details: string };

const labels: Record<PayoutMethod, string> = {
  bank_transfer: "Bank transfer",
  cash_app: "Cash App",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  check: "Check",
  other: "Other",
};

export function payoutMethodLabel(value: string | null | undefined) {
  return labels[value as PayoutMethod] ?? "Not configured";
}

export function PayoutDestinationForm({
  initial,
  onSave,
  title = "Where should payouts be sent?",
}: {
  initial: PayoutDestination | null;
  onSave: (value: PayoutDestination) => Promise<void>;
  title?: string;
}) {
  const [method, setMethod] = useState<PayoutMethod>(initial?.method ?? "bank_transfer");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMethod(initial?.method ?? "bank_transfer");
    setAccountName(initial?.accountName ?? "");
    setDetails(initial?.details ?? "");
  }, [initial?.method, initial?.accountName, initial?.details]);

  const accountNameLabel = method === "bank_transfer" ? "Bank account holder name" : "Account or payee name";
  const detailsLabel = method === "bank_transfer" ? "Routing and account details" : "Payment account details";

  return (
    <form
      className="rounded-lg border border-border bg-muted/30 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          await onSave({ method, accountName: accountName.trim(), details: details.trim() });
          setMessage("Payout details saved securely.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not save payout details");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Add or update the account where you want to receive payouts. These details are encrypted
        and shared only with authorized platform admins processing the payout.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Payment method
          <Select value={method} onValueChange={(value) => setMethod(value as PayoutMethod)}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(labels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="text-sm">
          {accountNameLabel}
          <input
            required
            maxLength={120}
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          {detailsLabel}
          <textarea
            required
            minLength={3}
            maxLength={1000}
            rows={3}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={
              method === "bank_transfer"
                ? "Bank name, routing number, account number, and checking or savings"
                : method === "check"
                  ? "Mailing address and check payee"
                  : "Handle, email, phone number or other payout instructions"
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Never enter a card number, CVV, online-banking password, PIN, or one-time code.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save payout details"}
        </button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}
