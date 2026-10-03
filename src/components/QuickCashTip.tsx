import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, Check, X } from "lucide-react";
import { logManualTip } from "@/lib/driver.functions";
import { TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";

type Source = "cash" | "venmo" | "cashapp" | "zelle" | "paypal" | "other";

const STRIPE_NOTE =
  "Log only tips you actually received. Customer payments from your Blue Collar Tips link or QR code are processed and recorded automatically through Stripe.";

const AMOUNTS = [500, 1000, 2000, 3000, 4000, 5000];
const SOURCES: { id: Source; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "venmo", label: "Venmo" },
  { id: "cashapp", label: "Cash App" },
  { id: "zelle", label: "Zelle" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
];

/** Fast tip entry: tap an amount, tap save. Method defaults to cash. */
export function CashTipForm({
  driverId,
  onLogged,
  autoFocusOther = false,
}: {
  driverId: string;
  onLogged: (cents: number, source: Source) => void;
  autoFocusOther?: boolean;
}) {
  const logTip = useServerFn(logManualTip);
  const [cents, setCents] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [source, setSource] = useState<Source>("cash");
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const amount = other ? Math.round(parseFloat(other) * 100) : cents;
  const valid =
    amount != null && Number.isFinite(amount) && amount >= TIP_MIN_CENTS && amount <= TIP_MAX_CENTS;
  const sourceLabel = SOURCES.find((s) => s.id === source)?.label ?? "Cash";

  async function save() {
    if (!valid || amount == null) {
      setMsg({
        ok: false,
        text: `Pick an amount between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`,
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await logTip({
        data: {
          amountCents: amount,
          source,
          customerName: customerName.trim() || null,
          note: note.trim() || null,
          driverId,
        },
      });
      setMsg({
        ok: true,
        text: `Saved ${dollars(amount)} ${sourceLabel.toLowerCase()} tip. No company or platform fee was applied.`,
      });
      setCents(null);
      setOther("");
      setCustomerName("");
      setNote("");
      onLogged(amount, source);
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save the tip." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Amount
        </div>
        <div className="grid grid-cols-3 gap-2">
          {AMOUNTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={!other && cents === c}
              onClick={() => {
                setCents(c);
                setOther("");
                setMsg(null);
              }}
              className={`rounded-xl border py-3.5 text-lg font-bold transition ${
                !other && cents === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary"
              }`}
            >
              ${c / 100}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:border-primary">
          <span className="text-lg font-bold text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            step="0.01"
            placeholder="Other amount"
            autoFocus={autoFocusOther}
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setMsg(null);
            }}
            className="w-full bg-transparent py-3 text-lg font-semibold outline-none"
          />
        </label>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Paid by
        </div>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={source === s.id}
              onClick={() => setSource(s.id)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                source === s.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Customer name (optional)"
          maxLength={120}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Job # or note (optional)"
          maxLength={500}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            msg.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg.ok && <Check size={16} />}
          {msg.text}
        </div>
      )}

      <button
        type="button"
        disabled={busy || !valid}
        onClick={save}
        className="w-full rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
      >
        {busy
          ? "Saving…"
          : valid && amount != null
            ? `Save ${dollars(amount)} ${sourceLabel} tip`
            : "Pick an amount"}
      </button>
      <p className="text-center text-xs text-muted-foreground">{STRIPE_NOTE}</p>
    </div>
  );
}

/** Floating "+ Cash tip" button that opens the quick entry sheet from any page. */
export function QuickCashTipButton({
  driverId,
  todayCents,
  onLogged,
}: {
  driverId: string;
  todayCents: number;
  onLogged: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-20 z-40 flex h-14 items-center gap-2 rounded-full bg-secondary px-5 font-semibold text-secondary-foreground shadow-lg transition hover:scale-105 md:bottom-6 md:right-24"
      >
        <Banknote size={20} /> + Cash tip
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Log a cash tip"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Log a tip</h2>
                <p className="text-sm text-muted-foreground">
                  Cash &amp; app tips today:{" "}
                  <b className="text-foreground">{dollars(todayCents)}</b>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X size={20} />
              </button>
            </div>
            <CashTipForm driverId={driverId} onLogged={onLogged} />
          </div>
        </div>
      )}
    </>
  );
}
