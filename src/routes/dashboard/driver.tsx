import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { getDriverDashboard, logManualTip } from "@/lib/driver.functions";
import { PRESET_TIPS, SPLIT, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";
import { createDriverOnboardingLink, refreshStripeStatus } from "@/lib/stripe.functions";
import { sendTipLinkSms } from "@/lib/sms.functions";
import { confirmCashTip, disputeCashTip, listUnverifiedTips } from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/dashboard/driver")({
  head: () => ({ meta: [{ title: "My dashboard — Blue Collar AI" }] }),
  component: DriverDashboard,
});

type DashData = Awaited<ReturnType<typeof getDriverDashboard>>;

function DriverDashboard() {
  const navigate = useNavigate();
  const getDash = useServerFn(getDriverDashboard);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      navigate({ to: "/auth" });
      return;
    }
    const d = await getDash();
    setData(d);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Center>Loading…</Center>;
  if (!data?.driver) {
    return (
      <Center>
        Your driver profile isn't set up yet. Ask your company admin to add you.
      </Center>
    );
  }

  const tipUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/${data.driver.companies?.slug}/d/${data.driver.slug}`
      : "";

  const totals = computeTotals(data.tips);
  const ratingStats = computeRatingStats(data.ratings);

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        title={data.driver.display_name}
        subtitle={data.driver.companies?.name ?? ""}
        onSignOut={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/" });
        }}
      />
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Tips this week (net)" value={dollars(totals.weekNet)} />
          <Stat label="Tips this month (net)" value={dollars(totals.monthNet)} />
          <Stat label="All-time (net)" value={dollars(totals.allNet)} />
          <Stat
            label="Owed to company/platform"
            value={dollars(totals.owedToCo)}
            hint="From cash & P2P tips"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Avg rating" value={ratingStats.avg ? ratingStats.avg.toFixed(2) + " ★" : "—"} />
          <Stat label="Ratings (all-time)" value={String(ratingStats.count)} />
          <Stat label="Ratings this month" value={String(ratingStats.month)} />
        </div>

        <Section title="My QR code & link">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="rounded-lg bg-white p-4">
              <QRCodeCanvas value={tipUrl} size={180} includeMargin />
            </div>
            <div className="flex-1">
              <div className="break-all rounded-md bg-muted px-3 py-2 text-sm">{tipUrl}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(tipUrl)}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  Copy link
                </button>
                <button onClick={downloadQR} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                  Download QR (PNG)
                </button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Print this on a business card, sticker, or clipboard. SMS send is coming in the
                next phase.
              </p>
            </div>
          </div>
        </Section>

        <LogTipPanel onLogged={load} />

        <StripePanel driverId={data.driver.id} stripeEnabled={!!data.driver.stripe_charges_enabled} />

        <SmsPanel driverId={data.driver.id} />

        <UnverifiedPanel onChange={load} />

        <Section title="Recent tips">
          <TipsTable tips={data.tips} />
        </Section>

        <Section title="Recent ratings & feedback">
          <RatingsList ratings={data.ratings} />
        </Section>

        {data.flags.length > 0 && (
          <Section title="Discrepancy flags">
            <ul className="divide-y divide-border">
              {data.flags.map((f) => (
                <li key={f.id} className="py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{f.reason}</span>
                    <span className="text-xs uppercase text-muted-foreground">{f.status}</span>
                  </div>
                  {f.notes && <p className="mt-1 text-muted-foreground">{f.notes}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function downloadQR() {
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "tip-qr.png";
  a.click();
}

function LogTipPanel({ onLogged }: { onLogged: () => void }) {
  const logTip = useServerFn(logManualTip);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<"cash" | "venmo" | "cashapp" | "zelle" | "paypal" | "other">("cash");
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (!Number.isFinite(cents) || cents < TIP_MIN_CENTS || cents > TIP_MAX_CENTS) {
      setMsg(`Amount must be between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`);
      return;
    }
    setBusy(true);
    try {
      await logTip({
        data: {
          amountCents: cents,
          source,
          customerName: customerName.trim() || null,
          note: note.trim() || null,
        },
      });
      setAmount("");
      setCustomerName("");
      setNote("");
      setMsg("Logged. You owe " + dollars(Math.round((cents * (SPLIT.company + SPLIT.platform)) / 100)) + " to the company/platform on this tip.");
      onLogged();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Could not log");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Log a cash / P2P tip">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Amount ($)
          <input
            type="number"
            min={1}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="text-sm">
          Method
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="cash">Cash</option>
            <option value="venmo">Venmo</option>
            <option value="cashapp">Cash App</option>
            <option value="zelle">Zelle</option>
            <option value="paypal">PayPal</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-1">
          Customer name (optional)
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            maxLength={120}
          />
        </label>
        <label className="text-sm">
          Note / job ref (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            maxLength={500}
          />
        </label>
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          {PRESET_TIPS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setAmount((c / 100).toFixed(2))}
              className="rounded-md border border-border px-3 py-1 text-xs"
            >
              ${(c / 100).toFixed(0)}
            </button>
          ))}
        </div>
        {msg && <div className="sm:col-span-2 rounded-md bg-muted px-3 py-2 text-sm">{msg}</div>}
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Log tip"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function TipsTable({ tips }: { tips: DashData["tips"] }) {
  if (!tips.length) return <Empty>No tips yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2">When</th>
            <th>Customer</th>
            <th>Method</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Your 80%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tips.map((t) => (
            <tr key={t.id}>
              <td className="py-2 text-muted-foreground">{new Date(t.created_at).toLocaleString()}</td>
              <td>{t.customer_name ?? "—"}</td>
              <td className="capitalize">{t.source}</td>
              <td className="text-right">{dollars(t.amount_cents)}</td>
              <td className="text-right font-medium">{dollars(t.driver_amount_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatingsList({ ratings }: { ratings: DashData["ratings"] }) {
  if (!ratings.length) return <Empty>No ratings yet.</Empty>;
  return (
    <ul className="divide-y divide-border">
      {ratings.slice(0, 20).map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex items-center justify-between">
            <span className="text-secondary">{"★".repeat(r.stars)}<span className="text-muted-foreground">{"★".repeat(5 - r.stars)}</span></span>
            <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          {r.feedback && <p className="mt-1 text-sm">{r.feedback}</p>}
          {r.customer_name && <p className="mt-1 text-xs text-muted-foreground">— {r.customer_name}</p>}
        </li>
      ))}
    </ul>
  );
}

function computeTotals(tips: DashData["tips"]) {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let weekNet = 0;
  let monthNet = 0;
  let allNet = 0;
  let owedToCo = 0;
  for (const t of tips) {
    const ts = new Date(t.created_at).getTime();
    allNet += t.driver_amount_cents;
    if (ts >= weekAgo) weekNet += t.driver_amount_cents;
    if (ts >= monthStart.getTime()) monthNet += t.driver_amount_cents;
    if (t.source !== "stripe") {
      owedToCo += t.company_amount_cents + t.platform_amount_cents;
    }
  }
  return { weekNet, monthNet, allNet, owedToCo };
}

function computeRatingStats(ratings: DashData["ratings"]) {
  if (!ratings.length) return { avg: 0, count: 0, month: 0 };
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const sum = ratings.reduce((a, r) => a + r.stars, 0);
  const month = ratings.filter((r) => new Date(r.created_at) >= monthStart).length;
  return { avg: sum / ratings.length, count: ratings.length, month };
}

// Shared bits
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="display mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-background px-6 text-center text-sm text-muted-foreground">{children}</div>;
}
export function TopBar({
  title,
  subtitle,
  onSignOut,
}: {
  title: string;
  subtitle?: string;
  onSignOut: () => void;
}) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{subtitle}</div>
          <div className="font-semibold">{title}</div>
        </div>
        <button onClick={onSignOut} className="rounded-md border border-border px-3 py-1.5 text-sm">
          Sign out
        </button>
      </div>
    </header>
  );
}