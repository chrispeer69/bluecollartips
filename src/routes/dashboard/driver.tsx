import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { auth } from "@/auth/client";
import { getDriverDashboard, logManualTip, updateDriverProfile, updateNotifyPrefs } from "@/lib/driver.functions";
import { getPayoutStatement } from "@/lib/payouts.functions";
import { getDriverWallet, requestWalletPayout, saveDriverPayoutDestination } from "@/lib/wallet.functions";
import { dollars } from "@/lib/constants";
import { sendTipLinkSms } from "@/lib/sms.functions";
import { confirmCashTip, disputeCashTip, listUnverifiedTips } from "@/lib/reconciliation.functions";
import { BrandedQRCode, DashboardShell, WorkspaceSelect, type DashboardNavItem } from "@/components/DashboardShell";
import { JoinWorkspacePanel } from "@/components/JoinWorkspacePanel";
import { PayoutDestinationForm, payoutMethodLabel } from "@/components/PayoutDestinationForm";
import { LeaveWorkspacePanel } from "@/components/LeaveWorkspacePanel";
import { Banknote, Building2, Landmark, LayoutDashboard, LifeBuoy, MessageSquareText, QrCode, Settings, WalletCards } from "lucide-react";
import { HelpCenter, TenantSupportPanel } from "@/components/SupportCenter";
import { SupportChatWidget } from "@/components/SupportChatWidget";
import { ProfilePhotoUploader } from "@/components/ProfilePhotoUploader";
import { MyReviewsPanel } from "@/components/MyReviewsPanel";
import { PayoutHistoryPanel } from "@/components/PayoutHistoryPanel";
import { CashTipForm, QuickCashTipButton } from "@/components/QuickCashTip";

type DriverPage = "overview" | "share" | "tips" | "reviews" | "earnings" | "payoutAccount" | "settings" | "support";
const driverNav: DashboardNavItem<DriverPage>[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "share", label: "QR & share", icon: QrCode, group: "Customer tools" },
  { id: "reviews", label: "My reviews", icon: MessageSquareText, group: "Customer tools" },
  { id: "tips", label: "Tips & activity", icon: Banknote, group: "Money" },
  { id: "earnings", label: "Earnings & withdrawals", icon: WalletCards },
  { id: "payoutAccount", label: "Payout account", icon: Landmark },
  { id: "settings", label: "Settings", icon: Settings, group: "Account" },
  { id: "support", label: "Help & support", icon: LifeBuoy, group: "Help" },
];

export const Route = createFileRoute("/dashboard/driver")({
  head: () => ({
    meta: [
      { title: "My dashboard — Blue Collar Tips" },
      { name: "description", content: "View your ratings, track tips, share your Stripe payment QR code, and record tips received outside the platform." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Employee dashboard — Blue Collar Tips" },
      { property: "og:description", content: "Track ratings and tips, share your Stripe payment QR code, and record tips received outside the platform." },
      { property: "og:url", content: "/dashboard/driver" },
    ],
  }),
  component: DriverDashboard,
});

type DashData = any;

function DriverDashboard() {
  const navigate = useNavigate();
  const getDash = useServerFn(getDriverDashboard);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [page, setPage] = useState<DriverPage>("share");
  const [composeSupport, setComposeSupport] = useState(0);

  const load = async (driverId?: string) => {
    const { data: session } = await auth.getSession();
    if (!session.session) {
      navigate({ to: "/auth" });
      return;
    }
    let selectedId = driverId;
    if (!selectedId && typeof window !== "undefined") {
      selectedId = localStorage.getItem("employeeWorkspaceId") ?? undefined;
    }
    let d = await getDash(selectedId ? { data: { driverId: selectedId } } : undefined);
    if (!d.driver && selectedId) {
      localStorage.removeItem("employeeWorkspaceId");
      d = await getDash();
    }
    if (d.driver && typeof window !== "undefined") {
      localStorage.setItem("employeeWorkspaceId", d.driver.id);
    }
    setData(d);
    setLoading(false);
  };
  useEffect(() => {
    const requestedPage = sessionStorage.getItem("employeeDashboardPage");
    if (requestedPage && driverNav.some((item) => item.id === requestedPage)) {
      setPage(requestedPage as DriverPage);
      sessionStorage.removeItem("employeeDashboardPage");
    }
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

  const pageTitle = driverNav.find((item) => item.id === page)?.label ?? "Overview";
  return (
    <DashboardShell
      title={data.driver.display_name}
      subtitle={`${data.driver.companies?.name ?? ""}${data.viewingAsAdmin ? " · Admin view" : ""}`}
      pageTitle={pageTitle}
      active={page}
      items={driverNav}
      mobileTabs={["share", "reviews", "tips", "earnings"]}
      onChange={setPage}
      onSignOut={async () => {
          await auth.signOut();
          navigate({ to: "/" });
      }}
      workspace={
        <label className="block rounded-xl border border-sidebar-border bg-card p-3">
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Building2 size={14} /> Workspace</span>
          {data.accessibleDrivers.length > 1 ? (
                <WorkspaceSelect
                  value={data.driver.id}
                  onChange={(value) => {
                    setLoading(true);
                    load(value);
                  }}
                  options={data.accessibleDrivers.map((driver) => {
                    const company = Array.isArray(driver.companies) ? driver.companies[0] : driver.companies;
                    return { value: driver.id, label: company?.name ?? "Company", detail: `${driver.display_name} · ${driver.status}` };
                  })}
                />
          ) : <span className="mt-1 block truncate text-sm font-semibold">{data.driver.companies?.name ?? "Company"}</span>}
        </label>
      }
    >

        <QuickCashTipButton driverId={data.driver.id} todayCents={totals.manualToday} onLogged={() => load(data.driver.id)} />

        {page === "overview" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Tips this week (net)" value={dollars(totals.weekNet)} />
          <Stat label="Tips this month (net)" value={dollars(totals.monthNet)} />
          <Stat label="All-time (net)" value={dollars(totals.allNet)} />
          <Stat
            label="Manual tips logged"
            value={dollars(totals.manualGross)}
            hint="Bookkeeping only · not withdrawable"
          />
        </div>}

        {page === "overview" && <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Avg rating" value={ratingStats.avg ? ratingStats.avg.toFixed(2) + " ★" : "—"} />
          <Stat label="Ratings (all-time)" value={String(ratingStats.count)} />
          <Stat label="Ratings this month" value={String(ratingStats.month)} />
        </div>}

        {page === "share" && <Section title="My QR code & link">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="rounded-lg bg-white p-4">
              <BrandedQRCode value={tipUrl} size={180} logoUrl={data.driver.companies?.logo_url} />
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
        </Section>}

        {showQR && <FullscreenQR url={tipUrl} logoUrl={data.driver.companies?.logo_url} onClose={() => setShowQR(false)} />}

        {page === "tips" && <LogTipPanel driverId={data.driver.id} onLogged={() => load(data.driver.id)} />}

        {page === "earnings" && <WalletPanel driverId={data.driver.id} viewingAsAdmin={!!data.viewingAsAdmin} onManageAccount={() => setPage("payoutAccount")} />}

        {page === "earnings" && <EarningsPanel driverId={data.driver.id} driverName={data.driver.display_name} />}

        {page === "earnings" && <Section title="Withdrawal history">
          <PayoutHistoryPanel driverId={data.driver.id} />
        </Section>}

        {page === "reviews" && <Section title="What customers said about me">
          <MyReviewsPanel
            companyId={data.driver.company_id}
            driverId={data.driver.id}
            driverName={data.driver.display_name}
          />
        </Section>}

        {page === "payoutAccount" && <PayoutAccountPanel driverId={data.driver.id} viewingAsAdmin={!!data.viewingAsAdmin} />}

        {page === "settings" && <ProfileSettingsPanel driver={data.driver} accountEmail={data.accountEmail} onSaved={() => load(data.driver.id)} />}

        {page === "settings" && <NotifyPrefsPanel driverId={data.driver.id} initial={!!data.driver.notify_sms} phone={data.driver.phone ?? null} />}

        {page === "settings" && <JoinWorkspacePanel />}

        {page === "settings" && !data.viewingAsAdmin && <LeaveWorkspacePanel companyId={data.driver.company_id} companyName={data.driver.companies?.name ?? "this workspace"} />}

        {page === "share" && <SmsPanel driverId={data.driver.id} />}

        {page === "support" && <Section title="Support tickets">
          <TenantSupportPanel companyId={data.driver.company_id} composeSignal={composeSupport} />
        </Section>}

        {page === "support" && <Section title="Help center">
          <HelpCenter audience="employee" onContact={() => { setComposeSupport((n) => n + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </Section>}

        {page === "tips" && <UnverifiedPanel driverId={data.driver.id} onChange={() => load(data.driver.id)} />}

        {(page === "overview" || page === "tips") && <Section title="Recent tips">
          <TipsTable tips={data.tips} />
        </Section>}

        {page === "overview" && <Section title="Recent ratings & feedback">
          <RatingsList ratings={data.ratings} />
          {data.ratings.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setPage("reviews")}
                className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium sm:w-auto"
              >
                Read &amp; print all my reviews
              </button>
            </div>
          )}
        </Section>}

        {page === "tips" && data.flags.length > 0 && (
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
      {!data.viewingAsAdmin && <SupportChatWidget companyId={data.driver.company_id} audience="employee" />}
    </DashboardShell>
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

function FullscreenQR({ url, logoUrl, onClose }: { url: string; logoUrl?: string | null; onClose: () => void }) {
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
        <BrandedQRCode value={url} size={Math.min(420, typeof window !== "undefined" ? window.innerWidth - 64 : 320)} logoUrl={logoUrl} />
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
  return (
    <Section title="Log a cash or app tip">
      <div className="max-w-xl">
        <CashTipForm driverId={driverId} onLogged={onLogged} />
      </div>
    </Section>
  );
}

function TipsTable({ tips }: { tips: DashData["tips"] }) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  if (!tips.length) return <Empty>No tips yet.</Empty>;
  const pageCount = Math.ceil(tips.length / pageSize);
  const visible = tips.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2">When</th>
            <th>Customer</th>
            <th>Method</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Your net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {visible.map((t) => (
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
    {pageCount > 1 && (
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, tips.length)} of {tips.length}</span>
        <div className="flex items-center gap-2">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    )}
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
  let manualGross = 0;
  let manualToday = 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  for (const t of tips) {
    const ts = new Date(t.created_at).getTime();
    allNet += t.driver_amount_cents;
    if (ts >= weekAgo) weekNet += t.driver_amount_cents;
    if (ts >= monthStart.getTime()) monthNet += t.driver_amount_cents;
    if (t.source !== "stripe") {
      manualGross += t.amount_cents;
      if (ts >= todayStart.getTime()) manualToday += t.amount_cents;
    }
  }
  return { weekNet, monthNet, allNet, manualGross, manualToday };
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

function WalletPanel({ driverId, viewingAsAdmin, onManageAccount }: { driverId: string; viewingAsAdmin: boolean; onManageAccount: () => void }) {
  const getWallet = useServerFn(getDriverWallet);
  const requestPayout = useServerFn(requestWalletPayout);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getDriverWallet>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");

  async function reload() {
    const result = await getWallet({ data: { driverId } });
    setWallet(result);
    setWithdrawalAmount((result.availableCents / 100).toFixed(2));
  }

  useEffect(() => {
    reload().catch((error) => setMsg(error instanceof Error ? error.message : "Could not load wallet"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  const withdrawalCents = Math.round(Number(withdrawalAmount) * 100);
  const validWithdrawal = wallet != null
    && Number.isFinite(withdrawalCents)
    && withdrawalCents >= wallet.minimumCents
    && withdrawalCents <= wallet.availableCents;

  return (
    <Section title="Tip wallet & withdrawals">
      {!wallet ? <p className="text-sm text-muted-foreground">Loading wallet…</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Available now" value={dollars(wallet.availableCents)} />
            <Stat label="Paid out" value={dollars(wallet.paidCents)} />
            <Stat label="Minimum withdrawal" value={dollars(wallet.minimumCents)} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div>
              <div className="font-medium">Payout account</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {wallet.payoutDestination
                  ? `${payoutMethodLabel(wallet.payoutDestination.method)} · ${wallet.payoutDestination.accountName}`
                  : "No payout account configured yet."}
              </p>
            </div>
            <button type="button" onClick={onManageAccount} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              {wallet.payoutDestination ? "Manage payout account" : "Set up payout account"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div>
              <label className="font-medium">Withdrawal amount
                <span className="mt-1 flex max-w-56 items-center rounded-md border border-input bg-background px-3">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="number"
                    min={(wallet.minimumCents / 100).toFixed(2)}
                    max={(wallet.availableCents / 100).toFixed(2)}
                    step="0.01"
                    value={withdrawalAmount}
                    onChange={(event) => setWithdrawalAmount(event.target.value)}
                    disabled={Boolean(wallet.openRequest)}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none disabled:opacity-50"
                  />
                </span>
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                {wallet.availableCents < wallet.minimumCents
                  ? `${dollars(wallet.minimumCents - wallet.availableCents)} more in tips is needed to reach the ${dollars(wallet.minimumCents)} minimum.`
                  : `Choose any amount from ${dollars(wallet.minimumCents)} to ${dollars(wallet.availableCents)}.`}
              </p>
              <p className="mt-2">Successful online tips are available immediately.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                After you request a payout, the Blue Collar Tips platform team will complete it within {wallet.processingDays === 0 ? "the same day" : `0–${wallet.processingDays} days`}.
              </p>
              {wallet.openRequest && (
                <p className="mt-2 font-medium">
                  {dollars(Number(wallet.openRequest.amount_cents))} payout requested · {String(wallet.openRequest.status)}
                </p>
              )}
              {viewingAsAdmin && <p className="mt-2 text-xs text-muted-foreground">The employee must sign in to request their own payout.</p>}
              {!wallet.payoutDestination && !viewingAsAdmin && <p className="mt-2 text-xs font-medium text-secondary">Set up your payout account before requesting a withdrawal.</p>}
            </div>
          <button
            disabled={busy || !wallet.canRequest || !validWithdrawal}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                await requestPayout({ data: { driverId, amountCents: withdrawalCents } });
                setMsg(`Payout requested for ${dollars(withdrawalCents)}.`);
                await reload();
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "Could not request payout");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Requesting…" : validWithdrawal ? `Request ${dollars(withdrawalCents)}` : "Enter withdrawal amount"}
          </button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </Section>
  );
}

function PayoutAccountPanel({ driverId, viewingAsAdmin }: { driverId: string; viewingAsAdmin: boolean }) {
  const getWallet = useServerFn(getDriverWallet);
  const saveDestination = useServerFn(saveDriverPayoutDestination);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getDriverWallet>> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    setWallet(await getWallet({ data: { driverId } }));
  }

  useEffect(() => {
    setWallet(null);
    setMessage(null);
    reload().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load payout account"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  return (
    <Section title={viewingAsAdmin ? "Employee payout account" : "My payout account"}>
      <p className="mb-4 text-sm text-muted-foreground">
        This is where approved withdrawals will be sent. Your details are encrypted and are never shown on your public rating or tip page.
      </p>
      {!wallet ? <p className="text-sm text-muted-foreground">Loading payout account…</p> : (
        <PayoutDestinationForm
          initial={wallet.payoutDestination}
          title="Payment destination"
          onSave={async (destination) => {
            await saveDestination({ data: { driverId, ...destination } });
            await reload();
          }}
        />
      )}
      {message && <p className="mt-3 text-sm text-destructive">{message}</p>}
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
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => setItems((await list({ data: { driverId } })).items);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!items.length) return null;
  return (
    <Section title="Manual tips to verify">
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
                disabled={busy}
                onClick={async () => { setBusy(true); setMessage(null); try { await confirm({ data: { tipId: t.id } }); await reload(); onChange(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not confirm tip"); } finally { setBusy(false); } }}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                disabled={busy}
                onClick={() => { setDisputingId(t.id); setDisputeReason(""); setMessage(null); }}
                className="rounded-md border border-border px-3 py-1 text-xs"
              >
                Dispute
              </button>
            </div>
            {disputingId === t.id && <form className="basis-full rounded-lg border border-border bg-muted/30 p-3" onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage(null);
              try {
                await dispute({ data: { tipId: t.id, reason: disputeReason.trim() || undefined } });
                setDisputingId(null);
                await reload();
                onChange();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Could not dispute tip");
              } finally { setBusy(false); }
            }}>
              <label className="text-xs font-medium">Why are you disputing this tip? (optional)
                <input value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setDisputingId(null)} className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                <button disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Submit dispute</button>
              </div>
            </form>}
          </li>
        ))}
      </ul>
      {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
    </Section>
  );
}

function EarningsPanel({ driverId, driverName }: { driverId: string; driverName: string }) {
  const payout = useServerFn(getPayoutStatement);
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [data, setData] = useState<Awaited<ReturnType<typeof getPayoutStatement>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await payout({
        data: {
          driverId,
          from: from ? new Date(from + "T00:00:00Z").toISOString() : undefined,
          to: to ? new Date(to + "T23:59:59Z").toISOString() : undefined,
        },
      });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function downloadCsv() {
    if (!data) return;
    const header = ["date","source","customer","gross","employee_net","company_share","platform_fee","verified","note"];
    const rows = data.tips.map((t) => [
      new Date(t.created_at).toISOString(),
      t.source,
      (t.customer_name ?? "").replaceAll(",", " "),
      (t.amount_cents / 100).toFixed(2),
      (t.driver_amount_cents / 100).toFixed(2),
      (t.company_amount_cents / 100).toFixed(2),
      (t.platform_amount_cents / 100).toFixed(2),
      t.verified ? "yes" : "",
      (t.note ?? "").replaceAll(",", " "),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${driverName.replace(/\s+/g, "-").toLowerCase()}-payouts-${from}_${to}.csv`;
    a.click();
  }

  return (
    <Section title="My earnings / payout statement">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        <button onClick={run} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm">{busy ? "…" : "Run"}</button>
        <button onClick={downloadCsv} disabled={!data} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Export CSV</button>
        <a
          href={`/print/employee/${driverId}?mode=statement&from=${encodeURIComponent(new Date(from + "T00:00:00Z").toISOString())}&to=${encodeURIComponent(new Date(to + "T23:59:59Z").toISOString())}`}
          target="_blank" rel="noopener noreferrer"
          className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
        >
          Print / PDF
        </a>
      </div>
      {err && <div className="mt-2 text-xs text-destructive">{err}</div>}
      {data && (
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Stat label="Gross" value={dollars(data.totals.gross)} />
          <Stat label="Your net" value={dollars(data.totals.driver)} />
          <Stat label="Company share" value={dollars(data.totals.company)} />
          <Stat label="Platform fee" value={dollars(data.totals.platform)} />
        </div>
      )}
      {data && data.tips.length === 0 && <div className="mt-3 text-xs text-muted-foreground">No tips in this range.</div>}
    </Section>
  );
}

function ProfileSettingsPanel({ driver, accountEmail, onSaved }: { driver: any; accountEmail: string | null; onSaved: () => void }) {
  const save = useServerFn(updateDriverProfile);
  const [displayName, setDisplayName] = useState(driver.display_name ?? "");
  const [phone, setPhone] = useState(driver.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const company = Array.isArray(driver.companies) ? driver.companies[0] : driver.companies;
  const fieldClass = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <Section title="Profile & identity">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          await save({ data: {
            driverId: driver.id, displayName, phone: phone || null,
          } });
          setMessage("Profile saved. Your QR code and link remain unchanged.");
          onSaved();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not save profile");
        } finally { setBusy(false); }
      }}>
        <label className="text-sm">Display name<input className={fieldClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} /></label>
        <label className="text-sm">Phone<input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></label>
        <div className="sm:col-span-2">
          <ProfilePhotoUploader
            driverId={driver.id}
            displayName={displayName || driver.display_name}
            initialPhotoUrl={driver.photo_url}
            onChanged={() => onSaved()}
          />
          <p className="mt-2 text-xs text-muted-foreground">Company admins and the profile owner can update this picture.</p>
        </div>
        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          <div className="text-xs text-muted-foreground">Login email · unique account identifier</div>
          <div className="mt-1 break-all font-medium">{accountEmail ?? "Unavailable"}</div>
        </div>
        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          <div className="text-xs text-muted-foreground">Organization · controlled by company admin</div>
          <div className="mt-1 font-medium">{company?.name ?? "Company"}</div>
        </div>
        <div className="sm:col-span-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Public path: /{company?.slug}/d/{driver.slug} · This stable identifier does not change when you edit your display name.
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save profile"}</button>
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </form>
    </Section>
  );
}

function NotifyPrefsPanel({ driverId, initial, phone }: { driverId: string; initial: boolean; phone: string | null }) {
  const save = useServerFn(updateNotifyPrefs);
  const [enabled, setEnabled] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Section title="Notifications">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const v = e.target.checked;
            setEnabled(v);
            setMsg(null);
            try {
              await save({ data: { driverId, notifySms: v } });
              setMsg("Saved ✓");
            } catch (err) {
              setEnabled(!v);
              setMsg(err instanceof Error ? err.message : "Failed");
            }
          }}
        />
        Text me when I get a new tip or rating
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        {phone ? `SMS will be sent to ${phone}.` : "Add a phone number to your profile so we can text you."}
      </p>
      {msg && <p className="mt-1 text-xs text-muted-foreground">{msg}</p>}
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
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-xs uppercase tracking-wider text-muted-foreground">{subtitle}</div>
          <div className="truncate font-semibold">{title}</div>
        </div>
        <button onClick={onSignOut} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm">
          Sign out
        </button>
      </div>
    </header>
  );
}
