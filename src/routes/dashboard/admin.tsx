import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { auth } from "@/auth/client";
import {
  createCompany,
  createDriver,
  assignCompanyTipToDriver,
  assignReviewToDriver,
  getAdminDashboard,
  resolveFlag,
  setDriverStatus,
  updateCompanyBranding,
} from "@/lib/admin.functions";
import { dollars } from "@/lib/constants";
import { Section, Stat, TopBar } from "./driver";
import { createInvite, listInvites, revokeInvite, listJoinRequests, reviewJoinRequest } from "@/lib/invites.functions";
import { platformOverview, suspendTenant, tenantFootprint, deleteTenant, updateTenantSlug, issueTenantAdminInvite } from "@/lib/platform.functions";
import { sendTipLinkSms } from "@/lib/sms.functions";
import { listTipDisputes, flagTipDispute, clearTipDispute, refundTip } from "@/lib/disputes.functions";
import { listLocations, createLocation, deleteLocation, setDriverLocation, updateReviewLinks } from "@/lib/locations.functions";
import {
  getCompanyWallet,
  getPlatformWallet,
  recoverStripeTip,
  requestCompanyWalletPayout,
  reviewPlatformWalletPayout,
  saveCompanyPayoutDestination,
  syncStripeTipHistory,
  updatePlatformWalletSettings,
} from "@/lib/wallet.functions";
import { BrandedQRCode, DashboardShell, WorkspaceSelect, type DashboardNavItem } from "@/components/DashboardShell";
import { PayoutDestinationForm, formatPayoutDetails, payoutMethodLabel } from "@/components/PayoutDestinationForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Crown, CreditCard, LayoutDashboard, LifeBuoy, MessageSquareText, Settings, ShieldCheck, Trophy, Users } from "lucide-react";
import { HelpCenter, SupportInbox, TenantSupportPanel } from "@/components/SupportCenter";
import { DispatchImportPanel } from "@/components/DispatchImportPanel";
import { PerformancePanel } from "@/components/PerformancePanel";
import { ReviewPrintPanel } from "@/components/ReviewPrintPanel";
import { TipPayrollPanel } from "@/components/TipPayrollPanel";
import { SupportChatWidget } from "@/components/SupportChatWidget";
import { VipCustomersPanel } from "@/components/VipCustomersPanel";
import { CompanyImportPanel } from "@/components/CompanyImportPanel";
import { reconciliationOverview } from "@/lib/reconciliation.functions";
import { ProfilePhotoUploader } from "@/components/ProfilePhotoUploader";

export const Route = createFileRoute("/dashboard/admin")({
  // ?support=<ticketId> deep-links from support emails straight to a ticket.
  validateSearch: (search: Record<string, unknown>): { support?: string } =>
    typeof search.support === "string" ? { support: search.support } : {},
  head: () => ({
    meta: [
      { title: "Admin — Blue Collar Tips" },
      { name: "description", content: "Manage employees, branding, invites, and tip reconciliation for your company on Blue Collar Tips." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Admin — Blue Collar Tips" },
      { property: "og:description", content: "Manage employees, branding, invites, and tip reconciliation for your company." },
      { property: "og:url", content: "/dashboard/admin" },
    ],
  }),
  component: AdminDashboard,
});

type Data = any;
type CompanyPage = "overview" | "employees" | "feedback" | "vip" | "performance" | "payments" | "settings" | "support";
type PlatformPage = "platformOverview" | "platformOrganizations" | "platformUsers" | "platformPayments" | "platformSupport" | "platformSettings";
type AdminPage = CompanyPage | PlatformPage;
const adminNav: DashboardNavItem<AdminPage>[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "employees", label: "Employees", icon: Users, group: "Manage" },
  { id: "feedback", label: "Ratings & feedback", icon: MessageSquareText },
  { id: "vip", label: "VIP customers", icon: Crown },
  { id: "performance", label: "Employee performance", icon: Trophy },
  { id: "payments", label: "Tips & payments", icon: CreditCard, group: "Money" },
  { id: "settings", label: "Company settings", icon: Settings, group: "Configure" },
  { id: "support", label: "Help & support", icon: LifeBuoy, group: "Help" },
];
const platformNav: DashboardNavItem<AdminPage>[] = [
  { id: "platformOverview", label: "Platform overview", icon: ShieldCheck, group: "Administration" },
  { id: "platformOrganizations", label: "Organizations", icon: Building2 },
  { id: "platformUsers", label: "Registered users", icon: Users, group: "Access" },
  { id: "platformPayments", label: "Platform earnings", icon: CreditCard, group: "Money" },
  { id: "platformSupport", label: "Support inbox", icon: LifeBuoy, group: "Support" },
  { id: "platformSettings", label: "Platform settings", icon: Settings, group: "Configure" },
];

function AdminDashboard() {
  const navigate = useNavigate();
  const get = useServerFn(getAdminDashboard);
  const createDrv = useServerFn(createDriver);
  const setStatus = useServerFn(setDriverStatus);
  const updateCo = useServerFn(updateCompanyBranding);
  const newCo = useServerFn(createCompany);
  const fixFlag = useServerFn(resolveFlag);
  const assignReview = useServerFn(assignReviewToDriver);

  const [data, setData] = useState<Data | null>(null);
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { support: supportTicketId } = Route.useSearch();
  const [page, setPage] = useState<AdminPage>(supportTicketId ? "support" : "overview");
  const [composeSupport, setComposeSupport] = useState(0);
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");
  const [inviteInfo, setInviteInfo] = useState<{ label: string; url: string; code: string } | null>(null);

  function showInvite(label: string, code: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setInviteInfo({ label, code, url: `${origin}/join/${code}` });
  }

  async function load(id?: string) {
    setLoadError(null);
    try {
      const { data: session } = await auth.getSession();
      if (!session.session) {
        navigate({ to: "/auth" });
        return;
      }
      let effectiveId = id;
      let usedStoredTenant = false;
      if (!effectiveId && import.meta.env.DEV) {
        const stored = typeof window !== "undefined" ? localStorage.getItem("devTenantId") : null;
        if (stored) {
          effectiveId = stored;
          usedStoredTenant = true;
        }
      }

      let d;
      try {
        d = await get({ data: { companyId: effectiveId } });
      } catch (error) {
        // A recreated/reseeded local DB makes a remembered tenant UUID stale.
        if (!usedStoredTenant) throw error;
        localStorage.removeItem("devTenantId");
        d = await get({ data: {} });
      }

      setData(d);
      if (d.company) setCompanyId(d.company.id);
      // Platform staff following a ticket email land in the inbox, not a tenant page.
      if (supportTicketId && d.isSuper) setPage("platformSupport");
      if (import.meta.env.DEV && d.company) {
        try { localStorage.setItem("devTenantId", d.company.id); } catch { /* ignore */ }
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the admin dashboard.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Center>Loading admin dashboard…</Center>;
  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Could not load the admin dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => { setLoading(true); load(); }}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Retry
            </button>
            <button
              onClick={() => navigate({ to: "/" })}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Home
            </button>
            <button
              onClick={async () => { await auth.signOut(); navigate({ to: "/auth" }); }}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!data?.company) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Blue Collar Tips" subtitle="Super admin" onSignOut={signOut(navigate)} />
        <div className="mx-auto max-w-3xl p-6">
          <NewCompanyForm onCreate={async (v) => {
            const r = await newCo({ data: v });
            showInvite(`Invite for ${v.name} admin`, r.inviteCode);
            await load(r.companyId);
          }} />
        </div>
      </div>
    );
  }

  const totals = sumTips(data.tips);
  const ratingStats = ratingAgg(data.ratings, data.drivers);

  const isPlatform = page.startsWith("platform");
  const visibleNav = isPlatform ? platformNav : adminNav;
  const pageTitle = visibleNav.find((item) => item.id === page)?.label ?? "Overview";
  const platformWorkspace = "__platform__";
  return (
    <DashboardShell
      title={isPlatform ? "Blue Collar Tips" : data.company.name}
      subtitle={isPlatform ? "Platform administration" : data.isSuper ? "Super admin" : "Company admin"}
      pageTitle={pageTitle}
      active={page}
      items={visibleNav}
      mobileTabs={isPlatform ? undefined : (["overview", "employees", "feedback", "payments"] as CompanyPage[] as any)}
      onChange={setPage}
      onSignOut={signOut(navigate)}
      workspace={
        <label className="block rounded-xl border border-sidebar-border bg-card p-3">
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground"><Building2 size={14} /> Workspace</span>
          {data.isSuper && data.companies?.length ? (
            <WorkspaceSelect
              value={isPlatform ? platformWorkspace : companyId ?? data.company.id}
              onChange={(value) => {
                if (value === platformWorkspace) {
                  setPage("platformOverview");
                  return;
                }
                setPage("overview");
                setCompanyId(value);
                setLoading(true);
                load(value);
              }}
              options={[
                { value: platformWorkspace, label: "Platform administration", detail: "All organizations" },
                ...data.companies.map((c) => ({ value: c.id, label: c.name, detail: "Company workspace" })),
              ]}
            />
          ) : <span className="mt-1 block truncate text-sm font-semibold">{data.company.name}</span>}
        </label>
      }
    >
        {inviteInfo && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="text-sm font-medium">{inviteInfo.label} — send this link</div>
                <div className="rounded-md border border-border bg-background p-2 font-mono text-xs break-all">
                  {inviteInfo.url}
                </div>
                <div className="text-xs text-muted-foreground">
                  Invite code: <span className="font-mono">{inviteInfo.code}</span> · Text or email this link to the recipient. They'll sign up and be joined automatically.
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { navigator.clipboard?.writeText(inviteInfo.url); }}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                >
                  Copy link
                </button>
                <button
                  onClick={() => setInviteInfo(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {page === "platformOrganizations" && data.isSuper && data.companies && data.companies.length > 0 && (
          <Section title="Organizations">
            <div className="flex flex-wrap items-center gap-3">
              <NewCompanyInline
                onCreate={async (v) => {
                  const r = await newCo({ data: v });
                  showInvite(`Invite for ${v.name} admin`, r.inviteCode);
                  await load(r.companyId);
                }}
              />
            </div>
          </Section>
        )}

        {page === "platformOrganizations" && data.isSuper && (
          <Section title="Import companies">
            <CompanyImportPanel onDone={() => load(companyId ?? undefined)} />
          </Section>
        )}

        {page === "overview" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Gross tips" value={dollars(totals.gross)} />
          <Stat label="After platform fee" value={dollars(totals.afterPlatform)} />
          <Stat label="Waiting for an employee" value={dollars(totals.company)} />
          <Stat label="Employees" value={String(data.drivers.length)} />
          <Stat label="Avg rating" value={ratingStats.avg ? ratingStats.avg.toFixed(2) + " ★" : "—"} />
        </div>}

        {page === "employees" && <Section title="Employees">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div>
              <div className="text-sm font-semibold">Company employee code</div>
              <p className="mt-1 text-xs text-muted-foreground">Share this permanent code. New employees remain pending until an admin approves them below.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-background px-4 py-2 font-mono text-xl font-bold tracking-[0.3em]">{data.company.join_code}</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(data.company.join_code)} className="rounded-md border border-border bg-card px-3 py-2 text-sm">Copy</button>
            </div>
          </div>
          <DriverRoster
            drivers={data.drivers}
            ratingsByDriver={ratingStats.byDriver}
            tipsByDriver={totals.byDriver}
            onCreate={async (v) => {
              const r = await createDrv({ data: { ...v, companyId: data.company!.id } });
              showInvite(`Invite for ${v.displayName || "employee"}`, r.inviteCode);
              await load(companyId);
            }}
            onStatus={async (driverId, status) => {
              await setStatus({ data: { driverId, status } });
              await load(companyId);
            }}
            companySlug={data.company.slug}
            companyLogo={data.company.logo_url}
            companyId={data.company.id}
            onLocationChanged={() => load(companyId)}
          />
        </Section>}

        {page === "settings" && <Section title="Branding">
          <BrandingForm
            initial={data.company}
            onSave={async (v) => {
              await updateCo({ data: { ...v, companyId: data.company!.id } });
              await load(companyId);
            }}
          />
        </Section>}

        {page === "employees" && <Section title="Locations / crews">
          <LocationsPanel companyId={data.company.id} />
        </Section>}

        {page === "settings" && <Section title="Public review destinations">
          <ReviewLinksPanel
            companyId={data.company.id}
            companySlug={data.company.slug}
            companyLogo={data.company.logo_url}
            initial={{
              google: data.company.google_review_url ?? "",
              yelp: data.company.yelp_review_url ?? "",
              facebook: data.company.facebook_review_url ?? "",
              appleMaps: data.company.apple_maps_review_url ?? "",
              bing: data.company.bing_review_url ?? "",
              usta: data.company.usta_review_url ?? "",
              threshold: data.company.positive_rating_threshold ?? 4,
              redirectUrl: data.company.positive_redirect_url ?? "",
              webhookEnabled: data.company.review_webhook_enabled ?? false,
              webhookUrl: data.company.review_webhook_url ?? "",
              tipWebhookEnabled: data.company.tip_webhook_enabled ?? false,
              tipWebhookUrl: data.company.tip_webhook_url ?? "",
            }}
            onSaved={() => load(companyId)}
          />
        </Section>}

        {(page === "overview" || page === "feedback") && <Section title="Recent ratings & feedback">
          <FeedbackList
            ratings={data.ratings}
            drivers={data.drivers}
            companyName={data.company?.name ?? "Company"}
            editable={page === "feedback"}
            filter={page === "feedback" ? feedbackFilter : "all"}
            onFilterChange={setFeedbackFilter}
            onAssign={async (ratingId, driverId) => {
              await assignReview({ data: { ratingId, driverId } });
              await load(companyId);
            }}
          />
        </Section>}

        {page === "vip" && <Section title="VIP customers — follow up to Convini registration">
          <VipCustomersPanel companyId={data.company.id} companySlug={data.company.slug} />
        </Section>}

        {page === "performance" && (
          <PerformancePanel
            companyId={data.company.id}
            onGoToFeedback={() => {
              setFeedbackFilter("unassigned");
              setPage("feedback");
            }}
          />
        )}

        {page === "feedback" && <Section title="Print reviews for handouts & performance reviews">
          <ReviewPrintPanel companyId={data.company.id} drivers={data.drivers} />
        </Section>}

        {page === "feedback" && <Section title="Attribute ratings from your dispatch export">
          <DispatchImportPanel companyId={data.company.id} onApplied={() => load(companyId)} />
        </Section>}

        {page === "feedback" && <Section title="Discrepancy flags">
          <FlagsList
            flags={data.flags}
            drivers={data.drivers}
            onResolve={async (id, status, notes) => {
              await fixFlag({ data: { flagId: id, status, notes } });
              await load(companyId);
            }}
          />
        </Section>}

        {page === "employees" && <Section title="Employee & admin invite codes">
          <InvitesPanel companyId={data.company.id} />
        </Section>}

        {page === "employees" && <Section title="Pending join requests">
          <JoinRequestsPanel companyId={data.company.id} onApproved={() => load(companyId)} />
        </Section>}

        {page === "payments" && <Section title="Weekly tip payroll report">
          <TipPayrollPanel companyId={data.company.id} />
        </Section>}

        {page === "payments" && <Section title="Tip disputes & refunds">
          <DisputesPanel
            companyId={data.company.id}
            tips={data.tips}
            drivers={data.drivers}
            onChanged={() => load(companyId)}
          />
        </Section>}

        {page === "payments" && <Section title="Company wallet">
          <CompanyWalletPanel key={`${data.company.id}-${data.tips.filter((tip: any) => tip.assigned_at).length}`} companyId={data.company.id} />
        </Section>}

        {page === "payments" && <Section title="Recent customer payments">
          <CompanyPaymentLedger tips={data.tips} drivers={data.drivers} companyName={data.company.name} />
        </Section>}

        {page === "payments" && <Section title="Employee earnings & payouts">
          <EmployeePayoutsPanel companyId={data.company.id} />
        </Section>}

        {page === "payments" && <Section title="Unassigned company tips">
          <UnassignedTipsPanel
            tips={data.tips}
            drivers={data.drivers}
            onChanged={() => load(companyId)}
          />
        </Section>}

        {page === "payments" && <Section title="How money moves">
          <MoneyFlowExplainer company={data.company} />
        </Section>}

        {page === "employees" && <Section title="SMS a tip link to a customer">
          <AdminSmsPanel drivers={data.drivers} />
        </Section>}

        {page === "support" && <Section title="Support tickets">
          <TenantSupportPanel
            companyId={data.company.id}
            initialTicketId={supportTicketId ?? null}
            composeSignal={composeSupport}
          />
        </Section>}

        {page === "support" && <Section title="Help center">
          <HelpCenter audience="admin" onContact={() => { setComposeSupport((n) => n + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </Section>}

        {page === "platformSupport" && data.isSuper && (
          <Section title="Support inbox — all tenants">
            <SupportInbox initialTicketId={supportTicketId ?? null} />
          </Section>
        )}

        {isPlatform && page !== "platformSupport" && data.isSuper && (
          <Section title={pageTitle}>
            <PlatformPanel view={page as PlatformPage} />
          </Section>
        )}
      {/* Super admins answer from the Support inbox instead of chatting with themselves. */}
      {!isPlatform && !data.isSuper && <SupportChatWidget companyId={data.company.id} audience="admin" />}
    </DashboardShell>
  );
}

function signOut(nav: ReturnType<typeof useNavigate>) {
  return async () => {
    await auth.signOut();
    nav({ to: "/" });
  };
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-background px-6 text-sm text-muted-foreground">{children}</div>;
}

function sumTips(tips: Data["tips"]) {
  let gross = 0;
  let company = 0;
  let platform = 0;
  const byDriver = new Map<string, number>();
  for (const t of tips) {
    gross += t.amount_cents;
    company += t.company_amount_cents;
    platform += t.platform_amount_cents;
    if (t.driver_id) byDriver.set(t.driver_id, (byDriver.get(t.driver_id) ?? 0) + t.driver_amount_cents);
  }
  return { gross, company, platform, afterPlatform: gross - platform, byDriver };
}
function ratingAgg(ratings: Data["ratings"], drivers: Data["drivers"]) {
  const byDriver = new Map<string, { sum: number; n: number }>();
  for (const r of ratings) {
    const cur = byDriver.get(r.driver_id) ?? { sum: 0, n: 0 };
    cur.sum += r.stars;
    cur.n += 1;
    byDriver.set(r.driver_id, cur);
  }
  void drivers;
  const totalN = ratings.length;
  const avg = totalN ? ratings.reduce((a, r) => a + r.stars, 0) / totalN : 0;
  return { avg, byDriver };
}

function DriverRoster({
  drivers,
  ratingsByDriver,
  tipsByDriver,
  onCreate,
  onStatus,
  companySlug,
  companyLogo,
  companyId,
  onLocationChanged,
}: {
  drivers: Data["drivers"];
  ratingsByDriver: Map<string, { sum: number; n: number }>;
  tipsByDriver: Map<string, number>;
  onCreate: (v: { displayName: string; email?: string | null; phone?: string | null; employeeId?: string | null }) => Promise<void>;
  onStatus: (id: string, s: "pending" | "active" | "deactivated") => Promise<void>;
  companySlug: string;
  companyLogo?: string | null;
  companyId: string;
  onLocationChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [empId, setEmpId] = useState("");
  const [qrFor, setQrFor] = useState<{ name: string; url: string } | null>(null);
  const [qrDriverId, setQrDriverId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [employeeMessage, setEmployeeMessage] = useState<string | null>(null);
  async function runEmployeeAction(action: () => void | Promise<void>) {
    setEmployeeMessage(null);
    try { await action(); } catch (error) {
      setEmployeeMessage(error instanceof Error ? error.message : "Could not update employee.");
    }
  }
  const listLocs = useServerFn(listLocations);
  const setLoc = useServerFn(setDriverLocation);
  const [locations, setLocations] = useState<Awaited<ReturnType<typeof listLocations>>>([]);
  useEffect(() => {
    listLocs({ data: { companyId } }).then(setLocations).catch(() => setLocations([]));
  }, [companyId, listLocs]);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">Employee directory</div>
          <p className="text-xs text-muted-foreground">
            Manage profiles, tip pages, and payouts in one place.
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          {open ? "Cancel" : "Add employee"}
        </button>
      </div>
      {open && (
        <form
          className="mb-4 grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await onCreate({
              displayName: name,
              email: email || null,
              phone: phone || null,
              employeeId: empId || null,
            });
            setName("");
            setEmail("");
            setPhone("");
            setEmpId("");
            setOpen(false);
          }}
        >
          <Input label="Name" value={name} onChange={setName} required />
          <Input label="Email" value={email} onChange={setEmail} type="email" required />
          <Input label="Phone" value={phone} onChange={setPhone} />
          <Input label="Employee ID" value={empId} onChange={setEmpId} />
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create & generate invite</button>
          </div>
        </form>
      )}
      {drivers.length === 0 ? (
        <div className="text-sm text-muted-foreground">No employees yet. Add one to get started.</div>
      ) : (
        <>
          <div className="mb-4">
            <input aria-label="Search employees" placeholder="Search employees by name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm sm:max-w-sm" />
          </div>
          <div className="space-y-3">
            {drivers.filter((d) => [d.display_name, d.email].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))).map((d) => {
              const r = ratingsByDriver.get(d.id);
              const avg = r && r.n ? (r.sum / r.n).toFixed(1) : "—";
              const expanded = expandedId === d.id;
              const path = `/${companySlug}/d/${d.slug}`;
              return (
                <div key={d.id} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                    <div className="min-w-0 flex-1 basis-44">
                      <div className="font-semibold">{d.display_name}</div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">{d.email || "No email added"}</div>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize">{d.status}</span>
                    <div className="min-w-16 text-right">
                      <div className="text-[11px] text-muted-foreground">Rating</div>
                      <div className="mt-1 text-sm tabular-nums">{avg}{avg !== "—" ? " ★" : ""}</div>
                    </div>
                    <div className="min-w-24 text-right">
                      <div className="text-[11px] text-muted-foreground">Net tips</div>
                      <div className="mt-1 font-semibold tabular-nums">{dollars(tipsByDriver.get(d.id) ?? 0)}</div>
                    </div>
                    <button type="button" aria-expanded={expanded} aria-controls={`employee-details-${d.id}`} aria-label={`Manage ${d.display_name}`} onClick={() => { setEmployeeMessage(null); setExpandedId(expanded ? null : d.id); }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                      {expanded ? "Close" : "Manage"}
                    </button>
                  </div>
                  {expanded && <div id={`employee-details-${d.id}`} className="space-y-5 border-t border-border bg-muted/20 p-4 sm:p-5">
                    <EmployeePhotoEditor driver={d} onSaved={onLocationChanged} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2 text-xs font-medium">Status
                        <Select value={d.status} onValueChange={(value) => runEmployeeAction(() => onStatus(d.id, value as "pending" | "active" | "deactivated"))}>
                          <SelectTrigger className="mt-2" aria-label={`Status for ${d.display_name}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="deactivated">Deactivated</SelectItem></SelectContent>
                        </Select>
                      </label>
                      <label className="space-y-2 text-xs font-medium">Location
                        <Select value={d.location_id ?? "unassigned"} onValueChange={(value) => runEmployeeAction(async () => {
                          await setLoc({ data: { driverId: d.id, locationId: value === "unassigned" ? null : value } });
                          onLocationChanged();
                        })}>
                          <SelectTrigger className="mt-2" aria-label={`Location for ${d.display_name}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="unassigned">Not assigned</SelectItem>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { setQrDriverId(d.id); setQrFor({ name: d.display_name, url: `${window.location.origin}${path}` }); }} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">View QR code</button>
                      <a href={path} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border bg-card px-4 py-2 text-sm">Open tip page</a>
                      <button type="button" onClick={() => {
                        localStorage.setItem("employeeWorkspaceId", d.id);
                        sessionStorage.setItem("employeeDashboardPage", "earnings");
                        window.location.assign("/dashboard/driver");
                      }} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">Payout details</button>
                      <button type="button" onClick={() => runEmployeeAction(async () => { await navigator.clipboard.writeText(d.id); setEmployeeMessage("Employee ID copied."); })} className="rounded-lg border border-border bg-card px-4 py-2 text-sm">Copy employee ID</button>
                    </div>
                    {employeeMessage && <p role="status" className="text-sm text-muted-foreground">{employeeMessage}</p>}
                  </div>}
                </div>
              );
            })}
            {!drivers.some((d) => [d.display_name, d.email].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))) && <p className="py-6 text-center text-sm text-muted-foreground">No employees match your search.</p>}
          </div>
        </>
      )}
      {qrFor && qrDriverId && (
        <DriverQRModal
          driverId={qrDriverId}
          driverName={qrFor.name}
          url={qrFor.url}
          logoUrl={companyLogo}
          companyId={companyId}
          onClose={() => { setQrFor(null); setQrDriverId(null); }}
        />
      )}
    </>
  );
}

function EmployeePhotoEditor({ driver, onSaved }: { driver: any; onSaved: () => void }) {
  return (
    <ProfilePhotoUploader
      driverId={driver.id}
      displayName={driver.display_name}
      initialPhotoUrl={driver.photo_url}
      onChanged={() => onSaved()}
    />
  );
}

function DriverQRModal({ driverId, driverName, url, logoUrl, companyId, onClose }: { driverId: string; driverName: string; url: string; logoUrl?: string | null; companyId?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const canvas = document.getElementById("admin-driver-qr") as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${driverName.replace(/\s+/g, "-").toLowerCase()}-tip-qr.png`;
    a.click();
  };
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-card p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{driverName} — Tip link</h3>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg bg-white p-4">
            <BrandedQRCode id="admin-driver-qr" value={url} size={240} logoUrl={logoUrl} />
          </div>
          <div className="w-full break-all rounded-md bg-muted px-3 py-2 text-xs">{url}</div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <button onClick={download} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
              Download QR (PNG)
            </button>
            <a
              href={`sms:?&body=${encodeURIComponent(`Thanks for choosing us! Rate & tip us: ${url}`)}`}
              className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
            >
              Open in Messages
            </a>
            <a
              href={`/print/employee/${driverId}?mode=poster`}
              target="_blank" rel="noopener noreferrer"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Print branded poster
            </a>
            <a
              href={`/print/employee/${driverId}?mode=statement`}
              target="_blank" rel="noopener noreferrer"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Print payout statement
            </a>
            {companyId && (
              <a
                href={`/print/reviews?companyId=${companyId}&driverId=${driverId}&autoprint=0`}
                target="_blank" rel="noopener noreferrer"
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Print reviews
              </a>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Print, email, or text this link. Use the SMS panel below to send through the platform
            (logs delivery).
          </p>
        </div>
      </div>
    </div>
  );
}

function BrandingForm({
  initial,
  onSave,
}: {
  initial: NonNullable<Data["company"]>;
  onSave: (v: { name?: string; logoUrl?: string | null; primaryColor?: string; secondaryColor?: string; supportEmail?: string | null; supportPhone?: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [logoUrl, setLogoUrl] = useState(initial.logo_url ?? "");
  const [primary, setPrimary] = useState(initial.primary_color ?? "#0b2545");
  const [secondary, setSecondary] = useState(initial.secondary_color ?? "#f59e0b");
  const [supportEmail, setSupportEmail] = useState(initial.support_email ?? "");
  const [supportPhone, setSupportPhone] = useState(initial.support_phone ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({
            name,
            logoUrl: logoUrl || null,
            primaryColor: primary,
            secondaryColor: secondary,
            supportEmail: supportEmail || null,
            supportPhone: supportPhone || null,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input label="Company name" value={name} onChange={setName} required />
      <Input label="Logo URL" value={logoUrl} onChange={setLogoUrl} placeholder="https://…" />
      <div className="text-sm">
        Primary color
        <div className="mt-1 flex items-center gap-2">
          <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 w-12 rounded border border-input" />
          <input value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="text-sm">
        Secondary color
        <div className="mt-1 flex items-center gap-2">
          <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-9 w-12 rounded border border-input" />
          <input value={secondary} onChange={(e) => setSecondary(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </div>
      </div>
      <Input label="Support email" value={supportEmail} onChange={setSupportEmail} type="email" />
      <Input label="Support phone" value={supportPhone} onChange={setSupportPhone} />
      <div className="sm:col-span-2">
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          {busy ? "Saving…" : "Save branding"}
        </button>
      </div>
    </form>
  );
}

const COMPANY_OPTION = "__company__";
type FeedbackFilter = "all" | "unassigned" | "low";

// Best-guess employee for a name dispatch sent: exact name, then first+last
// tokens, only when it points at one person.
function suggestDriver<T extends { id: string; display_name: string }>(drivers: T[], raw: string): T | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const target = norm(raw);
  const exact = drivers.filter((d) => norm(d.display_name) === target);
  if (exact.length === 1) return exact[0];
  const t = target.split(" ");
  if (t.length < 2) return null;
  const fuzzy = drivers.filter((d) => {
    const dt = norm(d.display_name).split(" ");
    return dt.length >= 2 && dt[0] === t[0] && dt[dt.length - 1] === t[t.length - 1];
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

function FeedbackList({
  ratings,
  drivers,
  companyName = "Company",
  editable = false,
  filter = "all",
  onFilterChange,
  onAssign,
}: {
  ratings: Data["ratings"];
  drivers: Data["drivers"];
  companyName?: string;
  editable?: boolean;
  filter?: FeedbackFilter;
  onFilterChange?: (filter: FeedbackFilter) => void;
  onAssign?: (ratingId: string, driverId: string | null) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  if (!ratings.length) return <div className="text-sm text-muted-foreground">No ratings yet.</div>;
  const byId = new Map(drivers.map((d) => [d.id, d.display_name]));
  const assignable = [...drivers].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const unassignedCount = ratings.filter((r) => !r.driver_id).length;
  const lowCount = ratings.filter((r) => r.stars <= 2).length;
  // The overview shows a short recent list; the feedback page can filter and
  // then sees everything that matches, so an unassigned review is never hidden
  // behind newer ones.
  const filtered =
    filter === "unassigned" ? ratings.filter((r) => !r.driver_id)
    : filter === "low" ? ratings.filter((r) => r.stars <= 2)
    : ratings;
  const visible = editable && filter !== "all" ? filtered.slice(0, 100) : filtered.slice(0, 30);
  const chips: Array<{ id: FeedbackFilter; label: string; count?: number }> = [
    { id: "all", label: "All" },
    { id: "unassigned", label: "Needs an employee", count: unassignedCount },
    { id: "low", label: "Low ratings", count: lowCount },
  ];
  return (
    <>
    {editable && onFilterChange && (
      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter reviews">
        {chips.map((chip) => {
          const active = filter === chip.id;
          const attention = chip.id === "unassigned" && (chip.count ?? 0) > 0 && !active;
          return (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilterChange(chip.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                active ? "border-primary bg-primary text-primary-foreground"
                : attention ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {chip.label}{chip.count != null && ` (${chip.count})`}
            </button>
          );
        })}
        {filter !== "all" && (
          <span className="text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length}
          </span>
        )}
      </div>
    )}
    {visible.length === 0 ? (
      <div className="text-sm text-muted-foreground">
        {filter === "unassigned" ? "Every review is assigned to an employee." : filter === "low" ? "No low ratings." : "No ratings yet."}
      </div>
    ) : (
    <ul className="divide-y divide-border">
      {visible.map((r) => (
        <li key={r.id} className="py-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-secondary">{"★".repeat(r.stars)}</span>
              <span className="text-muted-foreground">{"★".repeat(5 - r.stars)}</span>
              <span className="ml-2 text-xs text-muted-foreground">{String(byId.get(r.driver_id) ?? companyName)}</span>
              {!r.driver_id && (
                <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">needs an employee</span>
              )}
              {r.flagged && (
                <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">low rating</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          {r.feedback && <p className="mt-1">{r.feedback}</p>}
          {r.customer_name && <p className="text-xs text-muted-foreground">— {r.customer_name}</p>}
          {!r.driver_id && r.dispatch_driver_name && (
            <p className="mt-1 text-xs text-muted-foreground">
              Dispatch said: <span className="font-medium text-foreground">{r.dispatch_driver_name}</span>
              {editable && onAssign && (() => {
                const match = suggestDriver(assignable, r.dispatch_driver_name);
                return match ? (
                  <button
                    type="button"
                    className="ml-2 underline"
                    disabled={pendingId === r.id}
                    onClick={() => {
                      setPendingId(r.id);
                      Promise.resolve(onAssign(r.id, match.id)).finally(() => setPendingId(null));
                    }}
                  >
                    Assign to {match.display_name}
                  </button>
                ) : null;
              })()}
            </p>
          )}
          {editable && onAssign && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Employee</span>
              <Select
                value={r.driver_id ?? COMPANY_OPTION}
                onValueChange={(value) => {
                  const driverId = value === COMPANY_OPTION ? null : value;
                  if (driverId === (r.driver_id ?? null)) return;
                  setPendingId(r.id);
                  Promise.resolve(onAssign(r.id, driverId)).finally(() => setPendingId(null));
                }}
                disabled={pendingId === r.id}
              >
                <SelectTrigger className="h-8 max-w-52 text-xs" aria-label="Assign this review to an employee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={COMPANY_OPTION}>{companyName} (no employee)</SelectItem>
                  {assignable.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.display_name}{d.status !== "active" ? ` (${d.status})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </li>
      ))}
    </ul>
    )}
    </>
  );
}

function FlagsList({
  flags,
  drivers,
  onResolve,
}: {
  flags: Data["flags"];
  drivers: Data["drivers"];
  onResolve: (id: string, status: "open" | "resolved" | "violation", notes?: string | null) => Promise<void>;
}) {
  const byId = new Map(drivers.map((d) => [d.id, d.display_name]));
  if (!flags.length) return <div className="text-sm text-muted-foreground">No flags. ✨</div>;
  return (
    <ul className="divide-y divide-border">
      {flags.map((f) => (
        <li key={f.id} className="py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{String(byId.get(f.driver_id) ?? "Employee")}</div>
              <div className="text-xs text-muted-foreground">{f.reason}</div>
            </div>
            <Select
              value={f.status}
              onValueChange={(value) => onResolve(f.id, value as "open" | "resolved" | "violation")}
            >
              <SelectTrigger className="h-8 w-32 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="violation">Violation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.notes && <p className="mt-1 text-muted-foreground">{f.notes}</p>}
        </li>
      ))}
    </ul>
  );
}

function NewCompanyForm({ onCreate }: { onCreate: (v: { name: string; adminEmail: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">No tenant yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        As the platform super admin, create your first company tenant.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await onCreate({ name, adminEmail });
          setName("");
          setAdminEmail("");
        }}
      >
        <Input label="Company name" value={name} onChange={setName} required />
        <Input label="Admin email (for invite)" value={adminEmail} onChange={setAdminEmail} type="email" required />
        <div className="sm:col-span-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create tenant</button>
        </div>
      </form>
    </div>
  );
}

function NewCompanyInline({ onCreate }: { onCreate: (v: { name: string; adminEmail: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-sm">
        + New tenant
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await onCreate({ name, adminEmail });
        setName("");
        setAdminEmail("");
        setOpen(false);
      }}
    >
      <Input label="Name" value={name} onChange={setName} required />
      <Input label="Admin email" value={adminEmail} onChange={setAdminEmail} type="email" required />
      <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Create</button>
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function InvitesPanel({ companyId }: { companyId: string }) {
  const list = useServerFn(listInvites);
  const create = useServerFn(createInvite);
  const revoke = useServerFn(revokeInvite);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listInvites>>["items"]>([]);
  const [role, setRole] = useState<"driver" | "company_admin">("driver");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const reload = async () => setItems((await list({ data: { companyId } })).items);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Email invitations are for a specific person and auto-accept only when that exact email signs in. Use the 5-digit company code above for employees who should request approval.
      </p>
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            const r = await create({
              data: {
                companyId,
                role,
                email,
                phone: phone || null,
                recipientName: name || null,
              },
            });
            const bits = [
              `Invite code: ${r.code}`,
              `Link: ${r.inviteUrl}`,
              r.emailed ? "✓ Email sent" : email ? "⚠ Email not sent" : "",
              r.texted ? "✓ Text sent" : phone ? "⚠ Text not sent" : "",
              r.error ?? "",
            ].filter(Boolean);
            setMessage({ tone: "success", text: bits.join("\n") });
            setEmail("");
            setPhone("");
            setName("");
            await reload();
          } catch (err) {
            setMessage({ tone: "error", text: err instanceof Error ? err.message : "Failed to create invite" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-sm">
          Role
          <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
            <SelectTrigger className="mt-1 min-w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="driver">Employee</SelectItem>
              <SelectItem value="company_admin">Company admin</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Input label="Name (optional)" value={name} onChange={setName} />
        <Input label="Email" value={email} onChange={setEmail} type="email" required />
        <Input label="Phone (optional)" value={phone} onChange={setPhone} type="tel" placeholder="+1 555 555 5555" />
        <button disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60">
          {busy ? "Sending…" : "Send email invite"}
        </button>
      </form>
      {message && (
        <div className={`mb-3 whitespace-pre-wrap rounded-lg border p-3 text-sm ${message.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role="status">
          {message.text}
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No invites yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Code</th><th>Role</th><th className="hidden sm:table-cell">Email</th><th>Status</th><th className="hidden md:table-cell">Expires</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => {
                const expired = i.expires_at && new Date(i.expires_at) < new Date();
                const status = i.used_at ? "used" : expired ? "expired" : "active";
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                return (
                  <tr key={i.id}>
                    <td className="py-2"><span className="font-mono">{i.code}</span></td>
                    <td className="capitalize">{i.role.replace("_", " ")}</td>
                    <td className="hidden sm:table-cell">{i.email ?? "—"}</td>
                    <td><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{status}</span></td>
                    <td className="hidden md:table-cell text-xs">{i.expires_at ? new Date(i.expires_at).toLocaleDateString() : "—"}</td>
                    <td className="text-right">
                      <button onClick={() => navigator.clipboard.writeText(`${origin}/join/${i.code}`)} className="rounded border border-border px-2 py-1 text-xs">Copy link</button>
                      {status === "active" && (
                        <button onClick={async () => { await revoke({ data: { inviteId: i.id } }); await reload(); }} className="ml-1 rounded border border-border px-2 py-1 text-xs">Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function JoinRequestsPanel({ companyId, onApproved }: { companyId: string; onApproved: () => void }) {
  const list = useServerFn(listJoinRequests);
  const review = useServerFn(reviewJoinRequest);
  const [items, setItems] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reload = async () => setItems((await list({ data: { companyId } })).items);
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);
  const pending = items.filter((item) => item.status === "pending");
  if (!pending.length) return <div className="text-sm text-muted-foreground">No pending requests from shared employee codes.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Name</th><th>Email</th><th>Code</th><th>Requested</th><th></th></tr></thead>
        <tbody className="divide-y divide-border">
          {pending.map((item) => {
            const user = Array.isArray(item.users) ? item.users[0] : item.users;
            const invite = Array.isArray(item.invites) ? item.invites[0] : item.invites;
            const decide = async (decision: "approved" | "rejected") => {
              setBusyId(item.id);
              try {
                await review({ data: { requestId: item.id, decision } });
                await reload();
                if (decision === "approved") onApproved();
              } finally { setBusyId(null); }
            };
            return <tr key={item.id}><td className="py-2 font-medium">{user?.full_name || "—"}</td><td>{user?.email || "—"}</td><td className="font-mono text-xs">{invite?.code}</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td className="text-right"><button disabled={busyId === item.id} onClick={() => decide("approved")} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Approve</button><button disabled={busyId === item.id} onClick={() => decide("rejected")} className="ml-2 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50">Reject</button></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompanyWalletPanel({ companyId }: { companyId: string }) {
  const getWallet = useServerFn(getCompanyWallet);
  const requestPayout = useServerFn(requestCompanyWalletPayout);
  const saveDestination = useServerFn(saveCompanyPayoutDestination);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getCompanyWallet>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");

  async function reload() {
    const result = await getWallet({ data: { companyId } });
    setWallet(result);
    setWithdrawalAmount((result.availableCents / 100).toFixed(2));
  }
  useEffect(() => {
    reload().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load company wallet"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!wallet) return <p className="text-sm text-muted-foreground">Loading company wallet…</p>;
  const belowMinimum = wallet.availableCents < wallet.minimumCents;
  const withdrawalCents = Math.round(Number(withdrawalAmount) * 100);
  const validWithdrawal = Number.isFinite(withdrawalCents)
    && withdrawalCents >= wallet.minimumCents
    && withdrawalCents <= wallet.availableCents;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Available to withdraw" value={dollars(wallet.availableCents)} />
      <Stat label="Paid to company" value={dollars(wallet.paidCents)} />
      <Stat label="Minimum withdrawal" value={dollars(wallet.minimumCents)} />
    </div>
    <PayoutDestinationForm
      initial={wallet.payoutDestination}
      title="Company payout details"
      onSave={async (destination) => {
        await saveDestination({ data: { companyId, ...destination } });
        await reload();
      }}
    />
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
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
          {belowMinimum
            ? `${dollars(wallet.minimumCents - wallet.availableCents)} more in company share is needed to reach the ${dollars(wallet.minimumCents)} minimum.`
            : `Choose any amount from ${dollars(wallet.minimumCents)} to ${dollars(wallet.availableCents)}.`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Only successful Stripe tips finalized for the company, plus the company share from employee tips, are available. Payment is completed by the platform within 0–{wallet.processingDays} days.</p>
        {!wallet.payoutDestination && <p className="mt-2 text-xs font-medium text-secondary">Save company payout details above before requesting a payout.</p>}
      </div>
      <button type="button" disabled={busy || !wallet.canRequest || belowMinimum || !validWithdrawal} onClick={async () => {
        setBusy(true);
        setMessage(null);
        try {
          const result = await requestPayout({ data: { companyId, amountCents: withdrawalCents } });
          setMessage(`Payout request submitted for ${dollars(Number(result.request.amount_cents))}.`);
          await reload();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not request company payout");
        } finally { setBusy(false); }
      }} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Submitting…" : wallet.openRequest ? "Payout request pending" : belowMinimum ? `Reach ${dollars(wallet.minimumCents)} to withdraw` : validWithdrawal ? `Request ${dollars(withdrawalCents)}` : "Enter withdrawal amount"}
      </button>
    </div>
    {message && <p className="text-sm text-muted-foreground">{message}</p>}
    {wallet.requests.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2">Requested</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead>
        <tbody className="divide-y divide-border">{wallet.requests.map((request: any) => <tr key={request.id}>
          <td className="py-2">{new Date(request.requested_at).toLocaleString()}</td>
          <td>{dollars(Number(request.amount_cents))}</td>
          <td><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{request.status}</span></td>
          <td className="text-xs text-muted-foreground">{request.status === "paid" ? `${request.payment_method || "Paid"}${request.payment_reference ? ` · ${request.payment_reference}` : ""}` : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

function PlatformWalletPanel({ mode, onTipsChanged }: { mode: "settings" | "requests"; onTipsChanged?: () => void | Promise<void> }) {
  const getWallet = useServerFn(getPlatformWallet);
  const saveSettings = useServerFn(updatePlatformWalletSettings);
  const reviewPayout = useServerFn(reviewPlatformWalletPayout);
  const recoverPayment = useServerFn(recoverStripeTip);
  const syncHistory = useServerFn(syncStripeTipHistory);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getPlatformWallet>> | null>(null);
  const [minimum, setMinimum] = useState("25.00");
  const [processingDays, setProcessingDays] = useState("5");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [pendingAction, setPendingAction] = useState<{ requestId: string; requestType: "employee" | "company"; action: "reject" | "mark_paid" } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestCompany, setRequestCompany] = useState("all");
  const [requestStatus, setRequestStatus] = useState("open");
  const [requestType, setRequestType] = useState("all");

  async function reload() {
    const result = await getWallet();
    setWallet(result);
    setMinimum((result.minimumCents / 100).toFixed(2));
    setProcessingDays(String(result.processingDays));
  }

  useEffect(() => {
    reload().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load payouts"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(requestId: string, requestType: "employee" | "company", action: "approve" | "reject" | "mark_paid", details?: { paymentMethod?: string; paymentReference?: string; note?: string }) {
    setBusy(true);
    setMessage(null);
    try {
      await reviewPayout({ data: {
        requestId,
        requestType,
        action,
        paymentMethod: details?.paymentMethod?.trim() || null,
        paymentReference: details?.paymentReference?.trim() || null,
        note: details?.note?.trim() || null,
      } });
      setMessage(action === "mark_paid" ? "Payout marked paid." : action === "approve" ? "Payout approved." : "Payout rejected.");
      setPendingAction(null);
      setPaymentReference("");
      setPayoutNote("");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update payout");
    } finally {
      setBusy(false);
    }
  }

  const requests = wallet?.requests ?? [];
  const companyOptions = Array.from(new Map(requests.map((request: any) => [request.company_id, request.company_name])).entries());
  const normalizedRequestSearch = requestSearch.trim().toLowerCase();
  const filteredRequests = requests.filter((request: any) => {
    const matchesSearch = !normalizedRequestSearch || [request.recipient_name, request.company_name, request.payment_reference]
      .some((value) => value?.toLowerCase().includes(normalizedRequestSearch));
    const matchesCompany = requestCompany === "all" || request.company_id === requestCompany;
    const matchesStatus = requestStatus === "all"
      || (requestStatus === "open" && ["pending", "approved", "processing"].includes(request.status))
      || request.status === requestStatus;
    const matchesType = requestType === "all" || request.request_type === requestType;
    return matchesSearch && matchesCompany && matchesStatus && matchesType;
  });
  const openRequests = requests.filter((request: any) => ["pending", "approved", "processing"].includes(request.status));
  const paidRequests = requests.filter((request: any) => request.status === "paid");

  return (
    <div>
      {mode === "settings" && <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const minimumCents = Math.round(Number(minimum) * 100);
          const days = Number(processingDays);
          if (!Number.isFinite(minimumCents) || minimumCents < 100 || !Number.isInteger(days) || days < 0 || days > 5) {
            setMessage("Enter a minimum of at least $1 and a processing window from 0 to 5 days.");
            return;
          }
          setBusy(true);
          setMessage(null);
          try {
            await saveSettings({ data: { minimumCents, processingDays: days } });
            setMessage("Wallet settings saved.");
            await reload();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not save settings");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input label="Minimum withdrawal ($)" value={minimum} onChange={setMinimum} type="number" min="1" step="0.01" required />
        <Input label="Payout processing window (0–5 days)" value={processingDays} onChange={setProcessingDays} type="number" min="0" max="5" step="1" required />
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          Save settings
        </button>
      </form>}
      {mode === "settings" && <p className="mt-2 text-xs text-muted-foreground">
        Stripe tips are available to employees immediately. The processing window is how long your team may take to complete an approved payout; it is not a hold on earnings.
      </p>}
      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      {mode === "requests" && pendingAction && <form onSubmit={(event) => {
        event.preventDefault();
        if (pendingAction.action === "mark_paid") {
          act(pendingAction.requestId, pendingAction.requestType, "mark_paid", { paymentMethod, paymentReference });
        } else {
          act(pendingAction.requestId, pendingAction.requestType, "reject", { note: payoutNote });
        }
      }} className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{pendingAction.action === "mark_paid" ? "Record completed payout" : "Reject payout request"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{pendingAction.action === "mark_paid" ? "Record how this recipient was paid. A reference is optional." : "Add an optional internal reason before rejecting this request."}</p>
          </div>
          <button type="button" onClick={() => setPendingAction(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
        </div>
        {pendingAction.action === "mark_paid" ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Payment method
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="cash_app">Cash App</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Input label="Payment reference (optional)" value={paymentReference} onChange={setPaymentReference} />
        </div> : <div className="mt-3"><Input label="Reason (optional)" value={payoutNote} onChange={setPayoutNote} /></div>}
        <button disabled={busy} className={`mt-3 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50 ${pendingAction.action === "reject" ? "bg-destructive" : "bg-primary"}`}>
          {pendingAction.action === "mark_paid" ? "Confirm payment" : "Reject request"}
        </button>
      </form>}
      {mode === "requests" && <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Stripe tip recovery</h3>
            <p className="mt-1 text-xs text-muted-foreground">Sync historical Blue Collar Tips payments, or recover one successful payment by its Stripe ID.</p>
          </div>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              const result = await syncHistory();
              setMessage(`Stripe sync complete: ${result.recorded} added, ${result.alreadyRecorded} already recorded, ${result.skipped} unrelated or incomplete, ${result.failed} failed${result.capped ? "; stopped at 1,000 payments" : ""}.`);
              await reload();
              await onTipsChanged?.();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not sync Stripe history");
            } finally {
              setBusy(false);
            }
          }} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">Sync Stripe history</button>
        </div>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            const result = await recoverPayment({ data: { paymentIntentId: paymentIntentId.trim() } });
            setMessage(result.alreadyRecorded ? "This Stripe payment was already recorded." : `Recovered ${dollars(result.amountCents)} Stripe tip.`);
            setPaymentIntentId("");
            await reload();
            await onTipsChanged?.();
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not recover Stripe payment");
          } finally {
            setBusy(false);
          }
        }}>
          <input value={paymentIntentId} onChange={(event) => setPaymentIntentId(event.target.value)} placeholder="pi_..." required className="min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Recover payment</button>
        </form>
      </div>}
      {mode === "requests" && wallet && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Open payouts" value={`${openRequests.length} · ${dollars(openRequests.reduce((sum: number, request: any) => sum + Number(request.amount_cents), 0))}`} />
        <Stat label="Paid out" value={dollars(paidRequests.reduce((sum: number, request: any) => sum + Number(request.amount_cents), 0))} />
        <Stat label="Showing" value={`${filteredRequests.length} of ${requests.length}`} />
      </div>}
      {mode === "requests" && wallet && requests.length > 0 && <div className="mt-4 grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-4">
        <input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Search recipient or company" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <Select value={requestCompany} onValueChange={setRequestCompany}>
          <SelectTrigger><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All companies</SelectItem>{companyOptions.map(([id, name]) => <SelectItem key={String(id)} value={String(id)}>{String(name)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={requestStatus} onValueChange={setRequestStatus}>
          <SelectTrigger><SelectValue placeholder="Open payouts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open payouts</SelectItem><SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="paid">Paid</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={requestType} onValueChange={setRequestType}>
          <SelectTrigger><SelectValue placeholder="All recipients" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All recipients</SelectItem><SelectItem value="employee">Employees</SelectItem><SelectItem value="company">Companies</SelectItem></SelectContent>
        </Select>
      </div>}
      {mode === "requests" && (!wallet ? <p className="mt-4 text-sm text-muted-foreground">Loading payout requests…</p> : wallet.requests.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No payout requests yet.</p>
      ) : filteredRequests.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No payout requests match these filters.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border p-4">
          <h3 className="mb-3 font-semibold">Payout requests</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Recipient</th><th>Type</th><th>Company</th><th>Amount</th><th>Status</th><th>Requested</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRequests.map((request: any) => (
                <tr key={request.id}>
                  <td className="py-3">
                    <div className="font-medium">{request.recipient_name}</div>
                    {request.payout_destination_method ? <div className="mt-1 max-w-72 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{payoutMethodLabel(request.payout_destination_method)}</span>
                      {request.payout_destination_account_name ? ` · ${request.payout_destination_account_name}` : ""}
                      {request.payout_destination_details ? <div className="mt-0.5 whitespace-pre-wrap break-words">{formatPayoutDetails(request.payout_destination_method, request.payout_destination_details)}</div> : null}
                    </div> : <div className="mt-1 text-xs text-secondary">No payout details</div>}
                  </td>
                  <td className="capitalize">{request.request_type}</td>
                  <td>{request.company_name}</td>
                  <td>{dollars(Number(request.amount_cents))}</td>
                  <td className="capitalize">{String(request.status)}</td>
                  <td>{new Date(request.requested_at).toLocaleString()}</td>
                  <td className="whitespace-nowrap text-right">
                    {request.status === "pending" && <button disabled={busy} onClick={() => act(request.id, request.request_type, "approve")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Approve</button>}{" "}
                    {["pending", "approved"].includes(request.status) && <button disabled={busy} onClick={() => setPendingAction({ requestId: request.id, requestType: request.request_type, action: "reject" })} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Reject</button>}{" "}
                    {["pending", "approved", "processing"].includes(request.status) && <button disabled={busy} onClick={() => setPendingAction({ requestId: request.id, requestType: request.request_type, action: "mark_paid" })} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Mark paid</button>}
                    {request.status === "paid" && <span className="text-xs text-muted-foreground">{request.payment_method}{request.payment_reference ? ` · ${request.payment_reference}` : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function UnassignedTipsPanel({ tips, drivers, onChanged }: {
  tips: Data["tips"];
  drivers: Data["drivers"];
  onChanged: () => void | Promise<void>;
}) {
  const assignTip = useServerFn(assignCompanyTipToDriver);
  const activeDrivers = drivers.filter((driver: any) => driver.status === "active");
  const unassigned = tips.filter((tip: any) => !tip.driver_id && !tip.assigned_at && tip.verified && !tip.disputed && !tip.refunded_at);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!unassigned.length) return <p className="text-sm text-muted-foreground">No verified company tips are waiting for employee assignment.</p>;
  return <div>
    <p className="mb-3 text-xs text-muted-foreground">Choose an employee when identified, or finalize the tip for the company. Until a choice is made, the tip remains temporarily unassigned and its available share stays with the company.</p>
    {message && <p className="mb-3 text-sm text-muted-foreground">{message}</p>}
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2">Customer</th><th>Amount</th><th>Date</th><th>Employee</th><th></th></tr></thead>
        <tbody className="divide-y divide-border">{unassigned.map((tip: any) => {
          const selected = selections[tip.id] ?? "";
          return <tr key={tip.id}>
            <td className="py-3">{tip.customer_name || "Customer"}</td>
            <td>{dollars(Number(tip.amount_cents))}</td>
            <td>{new Date(tip.created_at).toLocaleString()}</td>
            <td><Select value={selected || undefined} onValueChange={(value) => setSelections((current) => ({ ...current, [tip.id]: value }))}>
              <SelectTrigger className="min-w-48"><SelectValue placeholder="Choose destination" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Company</SelectItem>
                {activeDrivers.map((driver: any) => <SelectItem key={driver.id} value={driver.id}>{driver.display_name}</SelectItem>)}
              </SelectContent>
            </Select></td>
            <td className="text-right"><button disabled={!selected || busyId === tip.id} onClick={async () => {
              setBusyId(tip.id);
              setMessage(null);
              try {
                const result = await assignTip({ data: { tipId: tip.id, driverId: selected === "company" ? null : selected } });
                setMessage(result.assignedTo === "company" ? "Tip finalized for the company." : "Tip assigned to the employee successfully.");
                await onChanged();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Could not assign tip");
              } finally {
                setBusyId(null);
              }
            }} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">Assign</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function csvCell(v: unknown) {
  const str = v == null ? "" : String(v);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function CompanyPaymentLedger({ tips, drivers, companyName }: { tips: Data["tips"]; drivers: Data["drivers"]; companyName: string }) {
  // Default range: this calendar month.
  const now = new Date();
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const [employee, setEmployee] = useState<string>("all");
  const driverNames = new Map<string, string>(drivers.map((driver: any) => [driver.id, driver.display_name]));

  const all = tips.filter((tip: any) => tip.source === "stripe" && tip.stripe_status === "succeeded" && tip.verified);
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  const payments = all.filter((tip: any) => {
    const t = new Date(tip.created_at).getTime();
    if (t < fromMs || t > toMs) return false;
    if (employee === "all") return true;
    if (employee === "__company__") return !tip.driver_id;
    return tip.driver_id === employee;
  });
  const status = (tip: any) => (tip.refunded_at ? "Refunded" : tip.disputed ? "Disputed" : "Paid");
  const counted = payments.filter((tip: any) => !tip.refunded_at && !tip.disputed);
  const totals = counted.reduce(
    (acc: any, tip: any) => {
      acc.gross += Number(tip.amount_cents);
      acc.driver += Number(tip.driver_amount_cents);
      acc.company += Number(tip.company_amount_cents);
      acc.platform += Number(tip.platform_amount_cents);
      return acc;
    },
    { gross: 0, driver: 0, company: 0, platform: 0 },
  );
  const refunded = payments.filter((tip: any) => tip.refunded_at).reduce((n: number, tip: any) => n + Number(tip.amount_cents), 0);

  function exportCsv() {
    downloadCsv(`${companyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-tips-${from || "start"}-to-${to || "today"}.csv`, [
      ["Paid at", "Customer", "Customer contact", "Employee", "Gross", "Employee share", "Company share", "Platform fee", "Status", "Stripe payment ID"],
      ...payments.map((tip: any) => [
        new Date(tip.created_at).toISOString(),
        tip.customer_name || "",
        tip.customer_contact || "",
        tip.driver_id ? driverNames.get(tip.driver_id) || "Unknown employee" : "Company / unassigned",
        (Number(tip.amount_cents) / 100).toFixed(2),
        (Number(tip.driver_amount_cents) / 100).toFixed(2),
        (Number(tip.company_amount_cents) / 100).toFixed(2),
        (Number(tip.platform_amount_cents) / 100).toFixed(2),
        status(tip),
        tip.stripe_payment_intent_id || "",
      ]),
      [],
      ["Totals (paid only)", "", "", "", (totals.gross / 100).toFixed(2), (totals.driver / 100).toFixed(2), (totals.company / 100).toFixed(2), (totals.platform / 100).toFixed(2), "", ""],
    ]);
  }

  if (!all.length) {
    return <p className="text-sm text-muted-foreground">No Stripe customer payments have been recorded yet.</p>;
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted-foreground">From
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
      </label>
      <label className="text-xs text-muted-foreground">To
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
      </label>
      <label className="text-xs text-muted-foreground">Employee
        <div className="mt-1">
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger className="h-8 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="__company__">Company / unassigned</SelectItem>
              {[...drivers].sort((a: any, b: any) => a.display_name.localeCompare(b.display_name)).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.display_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </label>
      <div className="flex gap-1 text-xs">
        <button type="button" className="rounded-md border border-border px-2 py-1.5" onClick={() => { setFrom(isoDay(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(isoDay(now)); }}>This month</button>
        <button type="button" className="rounded-md border border-border px-2 py-1.5" onClick={() => { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); setFrom(isoDay(s)); setTo(isoDay(e)); }}>Last month</button>
        <button type="button" className="rounded-md border border-border px-2 py-1.5" onClick={() => { setFrom(""); setTo(""); }}>All time</button>
      </div>
      <span className="flex-1" />
      <button type="button" onClick={exportCsv} disabled={!payments.length} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Download CSV</button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat label="Payments" value={String(counted.length)} hint={refunded ? `${dollars(refunded)} refunded` : undefined} />
      <Stat label="Gross" value={dollars(totals.gross)} />
      <Stat label="To employees" value={dollars(totals.driver)} />
      <Stat label="Waiting for an employee" value={dollars(totals.company)} />
      <Stat label="Platform fee" value={dollars(totals.platform)} />
    </div>

    {!payments.length ? <p className="text-sm text-muted-foreground">No payments in this range.</p> : <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr><th className="py-2">Paid</th><th>Customer</th><th>Employee</th><th>Gross</th><th>Employee net</th><th>Company share</th><th>Platform fee</th><th>Status</th><th>Stripe ID</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map((tip: any) => <tr key={tip.id} className={tip.refunded_at || tip.disputed ? "text-muted-foreground" : ""}>
            <td className="whitespace-nowrap py-3">
              <div>{new Date(tip.created_at).toLocaleString()}</div>
              {tip.id === all[0]?.id && <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Latest payment</span>}
            </td>
            <td>
              <div>{tip.customer_name || "Customer details not provided"}</div>
              {tip.customer_contact && <div className="text-xs text-muted-foreground">{tip.customer_contact}</div>}
            </td>
            <td>{tip.driver_id ? driverNames.get(tip.driver_id) || "Unknown employee" : "Company / unassigned"}</td>
            <td>{dollars(Number(tip.amount_cents))}</td>
            <td>{dollars(Number(tip.driver_amount_cents))}</td>
            <td>{dollars(Number(tip.company_amount_cents))}</td>
            <td>{dollars(Number(tip.platform_amount_cents))}</td>
            <td>{status(tip)}</td>
            <td className="font-mono text-xs">{tip.stripe_payment_intent_id || "—"}</td>
          </tr>)}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          <tr><td className="py-2" colSpan={3}>Totals (paid only)</td><td>{dollars(totals.gross)}</td><td>{dollars(totals.driver)}</td><td>{dollars(totals.company)}</td><td>{dollars(totals.platform)}</td><td colSpan={2}></td></tr>
        </tfoot>
      </table>
    </div>}
  </div>;
}

function EmployeePayoutsPanel({ companyId }: { companyId: string }) {
  const overview = useServerFn(reconciliationOverview);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof reconciliationOverview>>["rows"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    overview({ data: { companyId } })
      .then((r) => setRows(r.rows))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load employee earnings"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading employee earnings…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No employees yet.</p>;
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Per-employee view of what they have earned from card tips, what is sitting in their wallet, what they have requested, and what Blue Collar Tips has paid them. Employees request their own withdrawals from their dashboard.</p>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr><th className="py-2">Employee</th><th>Tips</th><th>Gross</th><th>Employee share</th><th>Available now</th><th>Payout pending</th><th>Paid out</th><th>Unverified cash (30d)</th><th>Last tip</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => <tr key={r.driverId} className={r.status !== "active" ? "text-muted-foreground" : ""}>
            <td className="py-2">{r.displayName}{r.status !== "active" && <span className="ml-1 text-xs">({r.status})</span>}</td>
            <td>{r.total}</td>
            <td>{dollars(r.grossCents)}</td>
            <td>{dollars(r.employeeNetCents)}</td>
            <td className="font-medium">{dollars(r.availableCents)}</td>
            <td>{r.pendingPayoutCents ? dollars(r.pendingPayoutCents) : "—"}</td>
            <td>{dollars(r.paidOutCents)}</td>
            <td>{r.unverified ? `${r.unverified} · ${dollars(r.amountUnverified)}` : "—"}</td>
            <td className="whitespace-nowrap text-xs text-muted-foreground">{r.lastTipAt ? new Date(r.lastTipAt).toLocaleDateString() : "—"}</td>
          </tr>)}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          <tr><td className="py-2">Total</td><td>{sum("total")}</td><td>{dollars(sum("grossCents"))}</td><td>{dollars(sum("employeeNetCents"))}</td><td>{dollars(sum("availableCents"))}</td><td>{dollars(sum("pendingPayoutCents"))}</td><td>{dollars(sum("paidOutCents"))}</td><td colSpan={2}></td></tr>
        </tfoot>
      </table>
    </div>
  </div>;
}

function MoneyFlowExplainer({ company: _company }: { company: Data["company"] }) {
  const step = (n: number, title: string, body: string) => (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <div><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">{body}</div></div>
    </li>
  );
  return <div className="grid gap-4 md:grid-cols-[1fr_auto]">
    <ol className="space-y-3">
      {step(1, "Customer tips by card", "Apple Pay, Google Pay or card on the rating page. Stripe processes it into the Blue Collar Tips account.")}
      {step(2, "Split instantly: 90% employee · 10% Blue Collar Tips", "Every tip stores its own split. The company keeps no share of card tips.")}
      {step(3, "The employee's share lands in their wallet", "Employee share → their Earnings wallet. Tips with no employee wait under Unassigned company tips until you assign them to someone.")}
      {step(4, "Request a withdrawal", "Once a wallet reaches the platform minimum, request any amount up to the available balance. One open request at a time.")}
      {step(5, "Blue Collar Tips pays it", "Reviewed and paid within the processing window to the payout method on file, then marked paid with a reference you can see here.")}
    </ol>
    <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground md:w-64">
      <div className="font-medium text-foreground">Not counted in wallets</div>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>Refunded tips (returned to the customer)</li>
        <li>Disputed tips (held until cleared)</li>
        <li>Cash / manual tips — bookkeeping only, no fee taken</li>
      </ul>
      <div className="mt-3 font-medium text-foreground">Need a hand?</div>
      <p className="mt-1">Help & support has a full guide and a ticket form for payout questions.</p>
    </div>
  </div>;
}

function AdminSmsPanel({ drivers }: { drivers: Data["drivers"] }) {
  const send = useServerFn(sendTipLinkSms);
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!drivers.length) return <div className="text-sm text-muted-foreground">Add an employee first.</div>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          const r = await send({ data: { driverId, toPhone: phone, customerName: name || null } });
          setMsg(r.status === "sent" ? "Sent ✓" : r.error || r.status);
        } catch (e) {
          setMsg(e instanceof Error ? e.message : "Failed");
        }
      }}
    >
      <label className="text-sm">
        Employee
        <Select value={driverId} onValueChange={setDriverId}>
          <SelectTrigger className="mt-1 min-w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.display_name}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <Input label="Customer phone" value={phone} onChange={setPhone} required />
      <Input label="Name (optional)" value={name} onChange={setName} />
      <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Send SMS</button>
      {msg && <div className="basis-full text-xs text-muted-foreground">{msg}</div>}
    </form>
  );
}

function PlatformPanel({ view }: { view: PlatformPage }) {
  const get = useServerFn(platformOverview);
  const suspend = useServerFn(suspendTenant);
  const [data, setData] = useState<Awaited<ReturnType<typeof platformOverview>> | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userCompany, setUserCompany] = useState("all");
  const [userRole, setUserRole] = useState("all");
  const [paymentCompany, setPaymentCompany] = useState("all");
  const reload = async () => setData(await get());
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const normalizedSearch = userSearch.trim().toLowerCase();
  const filteredUsers = data.users.filter((user) => {
    const matchesSearch = !normalizedSearch || [user.full_name, user.email, ...user.memberships.map((item) => item.companyName)]
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
    const matchesCompany = userCompany === "all" || user.memberships.some((item) => item.companyId === userCompany || (userCompany === "platform" && item.role === "super_admin"));
    const matchesRole = userRole === "all" || user.memberships.some((item) => item.role === userRole);
    return matchesSearch && matchesCompany && matchesRole;
  });
  const paymentTips = data.tips.filter((tip) => tip.source === "stripe" && (paymentCompany === "all" || tip.company_id === paymentCompany));
  const paymentTenants = paymentCompany === "all" ? data.tenants : data.tenants.filter((tenant) => tenant.id === paymentCompany);
  const paymentEmployees = paymentCompany === "all" ? data.employees : data.employees.filter((employee) => employee.company_id === paymentCompany);
  const paymentGross = paymentTips.reduce((sum, tip) => sum + Number(tip.amount_cents), 0);
  const paymentPlatformFees = paymentTips.reduce((sum, tip) => sum + Number(tip.platform_amount_cents), 0);
  return (
    <div className="space-y-4">
      {view === "platformPayments" && <PlatformWalletPanel mode="requests" onTipsChanged={reload} />}
      {view === "platformSettings" && <PlatformWalletPanel mode="settings" />}
      {view === "platformOverview" && <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Gross tips" value={dollars(data.grossTotal)} />
        <Stat label="Platform 10%" value={dollars(data.platformTotal)} />
        <Stat label="Tenants" value={String(data.tenants.length)} />
        <Stat label="Employees" value={String(data.driverCount)} />
        <Stat label="Registered users" value={String(data.userCount)} />
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border bg-muted/20 p-3">
        <label className="block max-w-md text-sm">View payment reporting by company
          <Select value={paymentCompany} onValueChange={setPaymentCompany}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="All companies" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All companies</SelectItem>{data.tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </div>}
      {view === "platformPayments" && <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gross Stripe tips" value={dollars(paymentGross)} />
        <Stat label="Platform fees earned" value={dollars(paymentPlatformFees)} />
        <Stat label="Stripe tips processed" value={String(paymentTips.length)} />
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Recent Stripe tips</h3>
        {paymentTips.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No Stripe tips are recorded for this company.</p> : <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Paid</th><th>Customer</th><th>Stripe ID</th><th>Company</th><th>Employee</th><th>Gross</th><th>After platform fee</th><th>Employee net</th><th>Company share</th></tr></thead><tbody className="divide-y divide-border">
            {paymentTips.slice(0, 100).map((tip) => {
              const company = data.tenants.find((tenant) => tenant.id === tip.company_id);
              const employee = data.employees.find((item) => item.id === tip.driver_id);
              return <tr key={tip.id}><td className="py-2">{new Date(tip.created_at).toLocaleString()}</td><td>{tip.customer_name || "Customer details not provided"}</td><td className="font-mono text-xs">{tip.stripe_payment_intent_id || "—"}</td><td>{company?.name || "—"}</td><td>{employee?.display_name || "Company / unassigned"}</td><td>{dollars(tip.amount_cents)}</td><td>{dollars(tip.amount_cents - tip.platform_amount_cents)}</td><td>{dollars(tip.driver_amount_cents)}</td><td>{dollars(tip.company_amount_cents)}</td></tr>;
            })}
          </tbody></table>
        </div>}
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Organization fee breakdown</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Organization</th><th>Tips</th><th>Gross</th><th>Company share</th><th>Platform fees</th></tr></thead><tbody className="divide-y divide-border">
            {paymentTenants.map((tenant) => <tr key={tenant.id}><td className="py-2 font-medium">{tenant.name}</td><td>{tenant.count}</td><td>{dollars(tenant.gross)}</td><td>{dollars(tenant.companyShare)}</td><td>{dollars(tenant.platformShare)}</td></tr>)}
          </tbody></table>
        </div>
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Employee earnings breakdown</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Employee</th><th>Email</th><th>Company</th><th>Tips</th><th>Gross</th><th>Employee net</th><th>Platform fee</th></tr></thead><tbody className="divide-y divide-border">
            {paymentEmployees.map((employee) => <tr key={employee.id}><td className="py-2 font-medium">{employee.display_name}</td><td>{employee.email || "—"}</td><td>{Array.isArray(employee.companies) ? employee.companies[0]?.name : employee.companies?.name}</td><td>{employee.count}</td><td>{dollars(employee.gross)}</td><td>{dollars(employee.net)}</td><td>{dollars(employee.platformShare)}</td></tr>)}
          </tbody></table>
        </div>
      </div>}
      {view === "platformUsers" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Registered users</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name, email or organization" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <Select value={userCompany} onValueChange={setUserCompany}>
            <SelectTrigger><SelectValue placeholder="All organizations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organizations</SelectItem>
              <SelectItem value="platform">Platform</SelectItem>
              {data.tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={userRole} onValueChange={setUserRole}>
            <SelectTrigger><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="super_admin">Super admin</SelectItem>
              <SelectItem value="company_admin">Company admin</SelectItem>
              <SelectItem value="driver">Employee</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Name</th><th>Email</th><th>Organization</th><th>Role</th><th>Created</th></tr></thead><tbody className="divide-y divide-border">{filteredUsers.map((user) => <tr key={user.id}><td className="py-2">{user.full_name || "—"}</td><td>{user.email}</td><td>{user.memberships.length ? user.memberships.map((item) => item.companyName).join(", ") : "Unassigned"}</td><td>{user.memberships.length ? user.memberships.map((item) => item.role.replace("driver", "employee").replaceAll("_", " ")).join(", ") : "—"}</td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted-foreground">Showing {filteredUsers.length} of {data.users.length} users.</p>
      </div>}
      {view === "platformOverview" && <div className="text-xs text-muted-foreground">
        Integrations · Stripe: <span className={data.integrations.stripe ? "text-emerald-600" : ""}>{data.integrations.stripe ? "connected" : "not connected"}</span>{" "}
        · Twilio: <span className={data.integrations.twilio ? "text-emerald-600" : ""}>{data.integrations.twilio ? "connected" : "not connected"}</span>
      </div>}
      {view === "platformOrganizations" && <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="py-2">Tenant</th><th>Status</th><th className="hidden sm:table-cell">Tips</th><th>Gross</th><th className="hidden md:table-cell">Co share</th><th className="hidden md:table-cell">Platform 10%</th><th className="hidden lg:table-cell">Pending co payout</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.tenants.map((t) => (
              <TenantRow key={t.id} tenant={t} onChanged={reload} onSuspend={async () => {
                await suspend({ data: { companyId: t.id, status: t.status === "active" ? "suspended" : "active" } });
                await reload();
              }} />
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

function TenantRow({ tenant: t, onChanged, onSuspend }: { tenant: any; onChanged: () => Promise<void>; onSuspend: () => Promise<void> }) {
  const footprint = useServerFn(tenantFootprint);
  const remove = useServerFn(deleteTenant);
  const setSlug = useServerFn(updateTenantSlug);
  const inviteAdmin = useServerFn(issueTenantAdminInvite);
  const [open, setOpen] = useState(false);
  const [fp, setFp] = useState<Awaited<ReturnType<typeof tenantFootprint>> | null>(null);
  const [slug, setSlugValue] = useState<string>(t.slug ?? "");
  const [email, setEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = typeof window !== "undefined" ? window.location.origin : "https://bluecollartips.app";

  async function toggle() {
    const next = !open;
    setOpen(next);
    setMsg(null);
    if (next && !fp) {
      try { setFp(await footprint({ data: { companyId: t.id } })); } catch (err) { setMsg(err instanceof Error ? err.message : "Could not load"); }
    }
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (err) { setMsg(err instanceof Error ? err.message : "Something went wrong"); } finally { setBusy(false); }
  }
  const nameMatches = confirmName.trim().toLowerCase() === String(t.name).trim().toLowerCase();

  return <>
    <tr>
      <td className="py-2 font-medium">
        <div>{t.name}</div>
        <div className="text-xs text-muted-foreground">/{fp?.slug ?? t.slug ?? "…"}</div>
      </td>
      <td><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{t.status}</span></td>
      <td className="hidden sm:table-cell">{t.count}</td>
      <td>{dollars(t.gross)}</td>
      <td className="hidden md:table-cell">{dollars(t.companyShare)}</td>
      <td className="hidden md:table-cell">{dollars(t.platformShare)}</td>
      <td className="hidden lg:table-cell">{dollars(t.pendingCompany)}</td>
      <td className="whitespace-nowrap text-right">
        <button onClick={toggle} className="rounded border border-border px-2 py-1 text-xs">{open ? "Close" : "Manage"}</button>
        <button onClick={onSuspend} className="ml-1 rounded border border-border px-2 py-1 text-xs">{t.status === "active" ? "Suspend" : "Reactivate"}</button>
      </td>
    </tr>
    {open && <tr>
      <td colSpan={8} className="bg-muted/30 p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-sm font-semibold">Company URL</div>
            <p className="mt-1 text-xs text-muted-foreground">Used for the company page, QR codes and every tip link. Changing it breaks anything already printed.</p>
            <div className="mt-2 flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">{base.replace(/^https?:\/\//, "")}/</span>
              <input value={slug} onChange={(e) => setSlugValue(e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm" />
            </div>
            <button disabled={busy || !slug.trim() || slug === (fp?.slug ?? t.slug)} onClick={() => run(async () => {
              const r = await setSlug({ data: { companyId: t.id, slug } });
              setSlugValue(r.slug); setFp((f) => (f ? { ...f, slug: r.slug } : f)); setMsg(`URL is now /${r.slug}`); await onChanged();
            })} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Save URL</button>
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-sm font-semibold">Company admin invite</div>
            <p className="mt-1 text-xs text-muted-foreground">Makes an existing account a company admin, or creates a 30-day invite link to send them.</p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
            <button disabled={busy || !email.includes("@")} onClick={() => run(async () => {
              const r = await inviteAdmin({ data: { companyId: t.id, email } });
              setInviteResult(r.attached ? `${email} is now a company admin.` : `Invite link: ${r.inviteUrl}`);
              await onChanged();
            })} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Invite / attach</button>
            {inviteResult && <div className="mt-2 flex items-start gap-2 text-xs">
              <span className="break-all">{inviteResult}</span>
              {inviteResult.startsWith("Invite link:") && <button onClick={() => navigator.clipboard?.writeText(inviteResult.replace("Invite link: ", ""))} className="shrink-0 rounded border border-border px-2 py-0.5">Copy</button>}
            </div>}
          </div>

          <div className="rounded-lg border border-destructive/40 bg-background p-3">
            <div className="text-sm font-semibold text-destructive">Delete tenant</div>
            {fp ? <p className="mt-1 text-xs text-muted-foreground">
              Removes {fp.drivers} employee{fp.drivers === 1 ? "" : "s"}, {fp.ratings} rating{fp.ratings === 1 ? "" : "s"}, {fp.tips} tip{fp.tips === 1 ? "" : "s"}, {fp.members} member{fp.members === 1 ? "" : "s"}, {fp.tickets} ticket{fp.tickets === 1 ? "" : "s"}. Cannot be undone.
            </p> : <p className="mt-1 text-xs text-muted-foreground">Loading…</p>}
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={`Type "${t.name}" to confirm`} className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
            {fp && fp.tips > 0 && <label className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Delete financial history too ({fp.tips} tips)
            </label>}
            <button disabled={busy || !nameMatches || (!!fp && fp.tips > 0 && !force)} onClick={() => run(async () => {
              await remove({ data: { companyId: t.id, confirmName, force } });
              await onChanged();
            })} className="mt-2 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground disabled:opacity-50">Delete permanently</button>
          </div>
        </div>
        {msg && <p className="mt-3 text-xs">{msg}</p>}
      </td>
    </tr>}
  </>;
}

function LocationsPanel({ companyId }: { companyId: string }) {
  const list = useServerFn(listLocations);
  const create = useServerFn(createLocation);
  const del = useServerFn(deleteLocation);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listLocations>>>([]);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const reload = async () => setItems(await list({ data: { companyId } }));
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await create({ data: { companyId, name: name.trim(), address: addr.trim() || null } });
          setName(""); setAddr("");
          await reload();
        }}
      >
        <Input label="Location / crew name" value={name} onChange={setName} required />
        <Input label="Address (optional)" value={addr} onChange={setAddr} />
        <button className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Add location</button>
      </form>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No locations yet — add one to group employees by yard or crew.</div>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {items.map((l) => (
            <li key={l.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium">{l.name}</div>
                {l.address && <div className="text-xs text-muted-foreground">{l.address}</div>}
              </div>
              {deletingId === l.id ? <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2">
                <span className="text-xs text-destructive">Delete this location?</span>
                <button type="button" onClick={async () => { await del({ data: { locationId: l.id } }); setDeletingId(null); await reload(); }} className="rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground">Delete</button>
                <button type="button" onClick={() => setDeletingId(null)} className="rounded-md border border-border px-2 py-1 text-xs">Cancel</button>
              </div> : <button type="button" onClick={() => setDeletingId(l.id)} className="rounded-md border border-border px-2 py-1 text-xs">Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewLinksPanel({
  companyId,
  companySlug,
  companyLogo,
  initial,
  onSaved,
}: {
  companyId: string;
  companySlug: string;
  companyLogo?: string | null;
  initial: { google: string; yelp: string; facebook: string; appleMaps: string; bing: string; usta: string; threshold: number; redirectUrl: string; webhookEnabled: boolean; webhookUrl: string; tipWebhookEnabled: boolean; tipWebhookUrl: string };
  onSaved: () => void;
}) {
  const save = useServerFn(updateReviewLinks);
  const [google, setGoogle] = useState(initial.google);
  const [yelp, setYelp] = useState(initial.yelp);
  const [facebook, setFacebook] = useState(initial.facebook);
  const [appleMaps, setAppleMaps] = useState(initial.appleMaps);
  const [bing, setBing] = useState(initial.bing);
  const [usta, setUsta] = useState(initial.usta);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [destination, setDestination] = useState<"none" | "google" | "yelp" | "facebook" | "custom">(() => {
    if (!initial.redirectUrl) return "none";
    if (initial.redirectUrl === initial.google) return "google";
    if (initial.redirectUrl === initial.yelp) return "yelp";
    if (initial.redirectUrl === initial.facebook) return "facebook";
    return "custom";
  });
  const [customRedirectUrl, setCustomRedirectUrl] = useState(
    initial.redirectUrl && ![initial.google, initial.yelp, initial.facebook].includes(initial.redirectUrl)
      ? initial.redirectUrl
      : "",
  );
  const [webhookEnabled, setWebhookEnabled] = useState(initial.webhookEnabled);
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl);
  const [tipWebhookEnabled, setTipWebhookEnabled] = useState(initial.tipWebhookEnabled);
  const [tipWebhookUrl, setTipWebhookUrl] = useState(initial.tipWebhookUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const companyUrl = typeof window !== "undefined" ? `${window.location.origin}/${companySlug}` : `/${companySlug}`;
  const downloadCompanyQr = () => {
    const canvas = document.getElementById("admin-company-qr") as HTMLCanvasElement | null;
    if (!canvas) return;
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${companySlug}-review-qr.png`;
    anchor.click();
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setMsg(null);
        try {
          await save({
            data: {
              companyId,
              googleUrl: google.trim() || null,
              yelpUrl: yelp.trim() || null,
              facebookUrl: facebook.trim() || null,
              appleMapsUrl: appleMaps.trim() || null,
              bingUrl: bing.trim() || null,
              ustaUrl: usta.trim() || null,
              positiveRatingThreshold: threshold,
              positiveReviewDestination: destination,
              customRedirectUrl: customRedirectUrl.trim() || null,
              reviewWebhookEnabled: webhookEnabled,
              reviewWebhookUrl: webhookUrl.trim() || null,
              tipWebhookEnabled,
              tipWebhookUrl: tipWebhookUrl.trim() || null,
            },
          });
          setMsg("Saved ✓");
          onSaved();
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "Failed");
        } finally { setBusy(false); }
      }}
    >
      <Input label="Google review URL" value={google} onChange={setGoogle} placeholder="https://g.page/r/…/review" />
      <Input label="Yelp review URL" value={yelp} onChange={setYelp} placeholder="https://www.yelp.com/writeareview/biz/…" />
      <Input label="Facebook review URL" value={facebook} onChange={setFacebook} placeholder="https://www.facebook.com/…/reviews" />
      <Input label="Apple Maps place URL" value={appleMaps} onChange={setAppleMaps} placeholder="https://maps.apple.com/place?…" />
      <Input label="Bing Places URL" value={bing} onChange={setBing} placeholder="https://www.bing.com/maps?…" />
      <Input label="US Tow Alliance profile URL" value={usta} onChange={setUsta} placeholder="https://www.ustowalliance.com/company/…/" />
      <label className="text-sm">Positive rating threshold
        <Select value={String(threshold)} onValueChange={(value) => setThreshold(Number(value))}>
          <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="1">All customers (any rating)</SelectItem><SelectItem value="4">4 stars and above</SelectItem><SelectItem value="5">5 stars only</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="text-sm">Redirect positive reviews to
        <Select value={destination} onValueChange={(value) => setDestination(value as typeof destination)}>
          <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="yelp">Yelp</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="custom">Custom URL</SelectItem>
            <SelectItem value="none">Thank-you page only</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {destination === "custom" && (
        <div className="sm:col-span-2">
          <Input label="Custom redirect URL" value={customRedirectUrl} onChange={setCustomRedirectUrl} placeholder="https://…" required />
        </div>
      )}
      <p className="sm:col-span-2 text-xs text-muted-foreground">
        After the tip step, customers who meet the threshold get the destination above as the main button, plus a
        button for every other review site filled in here. Google&apos;s policy asks businesses not to request reviews
        only from happy customers — choose &ldquo;All customers&rdquo; to follow it.
      </p>
      <div className="sm:col-span-2 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} />
          Send submitted reviews to this company’s webhook
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="GHL inbound webhook URL" value={webhookUrl} onChange={setWebhookUrl} placeholder="https://services.leadconnectorhq.com/hooks/…" required={webhookEnabled} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">This existing URL receives only <code>review.submitted</code>. Requests include an HMAC-SHA256 signature managed by the server environment.</p>
      </div>
      <div className="sm:col-span-2 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={tipWebhookEnabled} onChange={(e) => setTipWebhookEnabled(e.target.checked)} />
          Send successful tips to a separate webhook
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="GHL tip inbound webhook URL" value={tipWebhookUrl} onChange={setTipWebhookUrl} placeholder="https://services.leadconnectorhq.com/hooks/…" required={tipWebhookEnabled} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">This URL receives only <code>tip.received</code>, including the contact, driver, job number, amount, payment time, and original review. It cannot trigger the existing review workflow.</p>
      </div>
      <div className="sm:col-span-2 rounded-lg border border-border p-4">
        <div className="font-medium">Default company QR and feedback link</div>
        <p className="mt-1 text-xs text-muted-foreground">Use this when no employee can be matched.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <span className="rounded-md bg-white p-2"><BrandedQRCode id="admin-company-qr" value={companyUrl} size={112} logoUrl={companyLogo} /></span>
          <div>
            <div className="break-all text-xs">{companyUrl}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(companyUrl)} className="rounded-md border border-border px-3 py-2 text-sm">Copy company link</button>
              <button type="button" onClick={downloadCompanyQr} className="rounded-md border border-border px-3 py-2 text-sm">Download QR (PNG)</button>
            </div>
          </div>
        </div>
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          {busy ? "Saving…" : "Save review settings"}
        </button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        <span className="text-xs text-muted-foreground">Only customers who meet the threshold will be redirected.</span>
      </div>
    </form>
  );
}
function DisputesPanel({
  companyId,
  tips,
  drivers,
  onChanged,
}: {
  companyId: string;
  tips: Data["tips"];
  drivers: Data["drivers"];
  onChanged: () => void;
}) {
  const list = useServerFn(listTipDisputes);
  const flag = useServerFn(flagTipDispute);
  const clear = useServerFn(clearTipDispute);
  const refund = useServerFn(refundTip);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listTipDisputes>>["items"]>([]);
  const [tipId, setTipId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [refundTipId, setRefundTipId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const byId = new Map(drivers.map((d) => [d.id, d.display_name]));

  const reload = async () => {
    const r = await list({ data: { companyId } });
    setItems(r.items);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await reload();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const openTips = tips.filter((t) => !items.some((i) => i.id === t.id));

  return (
    <div className="space-y-5">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tipId || reason.trim().length < 3) {
            setMsg("Pick a tip and give a reason (3+ characters).");
            return;
          }
          run(() => flag({ data: { tipId, reason: reason.trim() } }), "Tip flagged — employee notified.").then(() => {
            setReason("");
            setTipId("");
          });
        }}
      >
        <label className="text-sm">
          Flag a tip
          <Select value={tipId || undefined} onValueChange={setTipId}>
            <SelectTrigger className="mt-1 min-w-64 max-w-full"><SelectValue placeholder="Select a tip…" /></SelectTrigger>
            <SelectContent>
            {openTips.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {dollars(t.amount_cents)} · {byId.get(t.driver_id) ?? "—"} · {t.source} ·{" "}
                {new Date(t.created_at).toLocaleDateString()}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
        <Input label="Reason" value={reason} onChange={setReason} />
        <button
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          Flag tip
        </button>
      </form>

      {msg && <div className="text-xs text-muted-foreground">{msg}</div>}

      {!items.length ? (
        <div className="text-sm text-muted-foreground">No flagged or refunded tips.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Employee</th>
                <th>Amount</th>
                <th className="hidden sm:table-cell">Source</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((t) => {
                const refunded = !!t.refunded_at;
                return (
                  <tr key={t.id} className={refunded ? undefined : "bg-destructive/5"}>
                    <td className="py-2 font-medium">{String(byId.get(t.driver_id) ?? "—")}</td>
                    <td>
                      {dollars(t.amount_cents)}
                      {refunded && t.refund_amount_cents ? (
                        <span className="block text-xs text-muted-foreground">
                          refunded {dollars(t.refund_amount_cents)}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden sm:table-cell capitalize">{t.source}</td>
                    <td>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {refunded ? "Refunded" : "Flagged"}
                      </span>
                    </td>
                    <td className="hidden max-w-[16rem] truncate md:table-cell text-muted-foreground">
                      {t.refund_reason || t.dispute_reason || "—"}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {!refunded && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(() => clear({ data: { tipId: t.id } }), "Dispute cleared — tip verified.")
                            }
                            className="rounded border border-border px-2 py-1 text-xs disabled:opacity-60"
                          >
                            Clear
                          </button>{" "}
                          <button
                            disabled={busy}
                            onClick={() => {
                              setRefundTipId(t.id);
                              setRefundAmount((t.amount_cents / 100).toFixed(2));
                            }}
                            className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground disabled:opacity-60"
                          >
                            Refund
                          </button>
                          {refundTipId === t.id && <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-left">
                            <label className="text-xs font-medium">Refund amount (maximum {dollars(t.amount_cents)})
                              <input type="number" min="0.01" max={(t.amount_cents / 100).toFixed(2)} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                            </label>
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={() => setRefundTipId(null)} className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                              <button type="button" disabled={busy} onClick={() => {
                                const cents = Math.round(Number(refundAmount) * 100);
                                if (!Number.isFinite(cents) || cents <= 0 || cents > t.amount_cents) { setMsg("Enter a valid refund amount."); return; }
                                run(() => refund({ data: { tipId: t.id, amountCents: cents, reason: t.dispute_reason ?? undefined } }), "Refund issued — employee and customer notified.").then(() => setRefundTipId(null));
                              }} className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground disabled:opacity-60">Confirm refund</button>
                            </div>
                          </div>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Flagged tips are held out of verified totals. Card tips refund through the processor; cash and app
            tips are reversed in-app. Both paths notify the employee, and refunds also notify the customer when
            we have their contact info.
          </p>
        </div>
      )}
    </div>
  );
}
