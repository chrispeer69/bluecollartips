import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { getDriverDashboard, logManualTip, updateNotifyPrefs } from "@/lib/driver.functions";
import { getPayoutStatement } from "@/lib/payouts.functions";
import { PRESET_TIPS, SPLIT, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";
import { createDriverOnboardingLink, refreshStripeStatus } from "@/lib/stripe.functions";
import { sendTipLinkSms } from "@/lib/sms.functions";
import { confirmCashTip, disputeCashTip, listUnverifiedTips } from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/dashboard/driver")({
  head: () => ({
    meta: [
      { title: "My dashboard — Blue Collar AI" },
      { name: "description", content: "View your ratings, track tips, share your QR code, and log cash or P2P tips from your Blue Collar AI employee dashboard." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Employee dashboard — Blue Collar AI" },
      { property: "og:description", content: "Track your ratings and tips, share your QR code, and log cash or P2P tips." },
      { property: "og:url", content: "/dashboard/driver" },
    ],
  }),
  component: DriverDashboard,
});

type DashData = Awaited<ReturnType<typeof getDriverDashboard>>;

function DriverDashboard() {
  const navigate = useNavigate();
  const getDash = useServerFn(getDriverDashboard);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);

  const load = async (driverId?: string) => {
    let { data: session } = await supabase.auth.getSession();
    if (!session.session && import.meta.env.DEV) {
      const { ensureDevSession } = await import("@/lib/dev-auth");
      await ensureDevSession();
      session = (await supabase.auth.getSession()).data;
    }
    if (!session.session) {
      navigate({ to: "/auth" });
      return;
    }
    const d = await getDash(driverId ? { data: { driverId } } : undefined);
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
        Your employee profile isn't set up yet. Ask your company admin to add you.
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
        subtitle={`${data.driver.companies?.name ?? ""}${data.viewingAsAdmin ? " · Developer access" : ""}`}
        onSignOut={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/" });
        }}
      />
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {data.accessibleDrivers.length > 1 && (
          <Section title="Developer employee access">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex-1 min-w-64">
                View any employee dashboard
                <select
                  value={data.driver.id}
                  onChange={(e) => {
                    setLoading(true);
                    load(e.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {data.accessibleDrivers.map((driver) => {
                    const company = Array.isArray(driver.companies) ? driver.companies[0] : driver.companies;
                    return (
                      <option key={driver.id} value={driver.id}>
                        {driver.display_name} · {company?.name ?? "Company"} · {driver.status}
                      </option>
                    );
                  })}
                </select>
              </label>
              <span className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Super admins and company admins can inspect employee views without being assigned to that employee.
              </span>
            </div>
          </Section>
        )}

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
                <button
                  onClick={() => setShowQR(true)}
                  className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
                >
                  Show QR fullscreen
                </button>
                <a
                  href={`/print/employee/${data.driver.id}?mode=poster`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  Print branded poster
                </a>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Print it on a card or sticker, hold your phone up for the customer to scan,
                or text them the link below.
              </p>
            </div>
          </div>
        </Section>

        {showQR && <FullscreenQR url={tipUrl} onClose={() => setShowQR(false)} />}

        <LogTipPanel driverId={data.driver.id} onLogged={() => load(data.driver.id)} />

        <EarningsPanel driverId={data.driver.id} driverName={data.driver.display_name} />

        <NotifyPrefsPanel driverId={data.driver.id} initial={!!data.driver.notify_sms} phone={data.driver.phone ?? null} />

        <StripePanel driverId={data.driver.id} stripeEnabled={!!data.driver.stripe_charges_enabled} />

        <SmsPanel driverId={data.driver.id} />

        <UnverifiedPanel driverId={data.driver.id} onChange={() => load(data.driver.id)} />

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

function FullscreenQR({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevBrightness = document.body.style.filter;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.filter = prevBrightness;
    };
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6"
    >
      <div className="rounded-xl bg-white p-4 shadow-2xl">
        <QRCodeCanvas value={url} size={Math.min(420, typeof window !== "undefined" ? window.innerWidth - 64 : 320)} includeMargin />
      </div>
      <div className="max-w-[90vw] break-all text-center text-sm text-neutral-700">{url}</div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded-md bg-neutral-900 px-5 py-2 text-sm text-white"
      >
        Close
      </button>
      <p className="text-xs text-neutral-500">Tap anywhere to close. Turn brightness up for best scanning.</p>
    </div>
  );
}

function LogTipPanel({ driverId, onLogged }: { driverId: string; onLogged: () => void }) {
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
          driverId,
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

function StripePanel({ driverId, stripeEnabled }: { driverId: string; stripeEnabled: boolean }) {
  const onboard = useServerFn(createDriverOnboardingLink);
  const refresh = useServerFn(refreshStripeStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Section title="Card tips (Stripe)">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          Status:{" "}
          <span className={stripeEnabled ? "font-medium text-emerald-600" : "text-muted-foreground"}>
            {stripeEnabled ? "Ready to accept cards" : "Not connected"}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await onboard({ data: { returnUrl: window.location.href, driverId } });
                window.location.href = r.url;
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "Stripe not configured");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {stripeEnabled ? "Update payout info" : "Connect Stripe"}
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await refresh({ data: { driverId } });
                setMsg(r.enabled ? "Refreshed." : "Stripe is not configured by the platform yet.");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Refresh status
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </Section>
  );
}

function SmsPanel({ driverId }: { driverId: string }) {
  const send = useServerFn(sendTipLinkSms);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Section title="Text my tip link to a customer">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            const r = await send({ data: { driverId, toPhone: phone, customerName: name || null } });
            setMsg(r.status === "sent" ? "Sent ✓" : r.status === "skipped" ? r.error : `Status: ${r.status}${r.error ? " — " + r.error : ""}`);
            setPhone("");
            setName("");
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Could not send");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-sm">
          Customer phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="(555) 555-0100" className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-48 rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          {busy ? "Sending…" : "Send SMS"}
        </button>
      </form>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </Section>
  );
}

function UnverifiedPanel({ driverId, onChange }: { driverId: string; onChange: () => void }) {
  const list = useServerFn(listUnverifiedTips);
  const confirm = useServerFn(confirmCashTip);
  const dispute = useServerFn(disputeCashTip);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listUnverifiedTips>>["items"]>([]);
  const reload = async () => setItems((await list({ data: { driverId } })).items);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!items.length) return null;
  return (
    <Section title="Cash / P2P tips to verify">
      <p className="mb-2 text-xs text-muted-foreground">
        Confirm tips you actually received so your earnings reconcile. Disputed tips notify your admin.
      </p>
      <ul className="divide-y divide-border text-sm">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <span className="font-medium">{dollars(t.amount_cents)}</span>{" "}
              <span className="capitalize text-muted-foreground">{t.source}</span>{" "}
              {t.customer_name && <span className="text-xs text-muted-foreground">· {t.customer_name}</span>}
              <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => { await confirm({ data: { tipId: t.id } }); await reload(); onChange(); }}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
              >
                Confirm
              </button>
              <button
                onClick={async () => { const r = window.prompt("Why dispute this?") ?? undefined; await dispute({ data: { tipId: t.id, reason: r } }); await reload(); onChange(); }}
                className="rounded-md border border-border px-3 py-1 text-xs"
              >
                Dispute
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
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