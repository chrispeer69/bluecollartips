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
  bank_transfer: "U.S. bank account (ACH)",
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

type UsBankDetails = {
  type: "us_bank";
  bankName: string;
  accountType: "checking" | "savings";
  routingNumber: string;
  accountNumber: string;
};

function parseUsBankDetails(value: string | null | undefined): UsBankDetails | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<UsBankDetails>;
    if (
      parsed.type === "us_bank" &&
      typeof parsed.bankName === "string" &&
      (parsed.accountType === "checking" || parsed.accountType === "savings") &&
      typeof parsed.routingNumber === "string" &&
      typeof parsed.accountNumber === "string"
    ) return parsed as UsBankDetails;
  } catch {
    // Older bank destinations were stored as encrypted free text.
  }
  return null;
}

export function formatPayoutDetails(method: string | null | undefined, details: string | null | undefined) {
  if (!details) return "";
  if (method !== "bank_transfer") return details;
  const bank = parseUsBankDetails(details);
  if (!bank) return details;
  return [
    `Bank: ${bank.bankName}`,
    `Account type: ${bank.accountType}`,
    `Routing number: ${bank.routingNumber}`,
    `Account number: ${bank.accountNumber}`,
  ].join("\n");
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
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [editing, setEditing] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const bank = parseUsBankDetails(initial?.details);
    setMethod(initial?.method ?? "bank_transfer");
    setAccountName(initial?.accountName ?? "");
    setDetails(initial?.details ?? "");
    setBankName(bank?.bankName ?? "");
    setAccountType(bank?.accountType ?? "checking");
    setRoutingNumber(bank?.routingNumber ?? "");
    setAccountNumber(bank?.accountNumber ?? "");
    setEditing(!initial);
  }, [initial?.method, initial?.accountName, initial?.details]);

  const accountNameLabel = method === "bank_transfer" ? "Bank account holder name" : "Account or payee name";
  const bank = parseUsBankDetails(initial?.details);

  function cancelEditing() {
    const savedBank = parseUsBankDetails(initial?.details);
    setMethod(initial?.method ?? "bank_transfer");
    setAccountName(initial?.accountName ?? "");
    setDetails(initial?.details ?? "");
    setBankName(savedBank?.bankName ?? "");
    setAccountType(savedBank?.accountType ?? "checking");
    setRoutingNumber(savedBank?.routingNumber ?? "");
    setAccountNumber(savedBank?.accountNumber ?? "");
    setMessage(null);
    setEditing(false);
  }

  if (initial && !editing) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="font-medium">{title}</div>
        <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
          <div className="font-medium">{payoutMethodLabel(initial.method)}</div>
          <div className="mt-1 text-muted-foreground">{initial.accountName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {bank
              ? `${bank.bankName} · ${bank.accountType} ending in ${bank.accountNumber.slice(-4)}`
              : "Payout instructions saved securely."}
          </div>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="mt-3 rounded-md border border-border bg-card px-4 py-2 text-sm">
          Edit payout account
        </button>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border border-border bg-muted/30 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          const savedDetails = method === "bank_transfer"
            ? JSON.stringify({ type: "us_bank", bankName: bankName.trim(), accountType, routingNumber, accountNumber })
            : details.trim();
          await onSave({ method, accountName: accountName.trim(), details: savedDetails });
          setMessage("Payout details saved securely.");
          setEditing(false);
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
          <Select value={method} onValueChange={(value) => {
            const next = value as PayoutMethod;
            if (method === "bank_transfer" && next !== "bank_transfer") setDetails("");
            setMethod(next);
          }}>
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
        {method === "bank_transfer" ? <>
          <label className="text-sm">
            Bank name
            <input required maxLength={120} value={bankName} onChange={(event) => setBankName(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            Account type
            <Select value={accountType} onValueChange={(value) => setAccountType(value as "checking" | "savings")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="checking">Checking</SelectItem><SelectItem value="savings">Savings</SelectItem></SelectContent>
            </Select>
          </label>
          <label className="text-sm">
            Routing number
            <input required inputMode="numeric" autoComplete="off" pattern="[0-9]{9}" minLength={9} maxLength={9} value={routingNumber} onChange={(event) => setRoutingNumber(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="9 digits" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            Account number
            <input required inputMode="numeric" autoComplete="off" pattern="[0-9]{4,17}" minLength={4} maxLength={17} value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 17))} placeholder="4–17 digits" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
        </> : <label className="text-sm sm:col-span-2">
          Payment account details
          <textarea
            required
            minLength={3}
            maxLength={1000}
            rows={3}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={
              method === "check"
                  ? "Mailing address and check payee"
                  : "Handle, email, phone number or other payout instructions"
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>}
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
        {initial && <button type="button" disabled={busy} onClick={cancelEditing} className="rounded-md border border-border bg-card px-4 py-2 text-sm disabled:opacity-50">Cancel</button>}
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}
