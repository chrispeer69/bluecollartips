import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { auth } from "@/auth/client";
import {
  createCompany,
  createDriver,
  getAdminDashboard,
  resolveFlag,
  setDriverStatus,
  updateCompanyBranding,
  getThankYouTemplates,
  updateThankYouTemplates,
} from "@/lib/admin.functions";
import { dollars } from "@/lib/constants";
import { Section, Stat, TopBar } from "./driver";
import { createInvite, listInvites, revokeInvite, listJoinRequests, reviewJoinRequest } from "@/lib/invites.functions";
import { reconciliationOverview } from "@/lib/reconciliation.functions";
import { platformOverview, suspendTenant } from "@/lib/platform.functions";
import { sendTipLinkSms } from "@/lib/sms.functions";
import { listTipDisputes, flagTipDispute, clearTipDispute, refundTip } from "@/lib/disputes.functions";
import { listLocations, createLocation, deleteLocation, setDriverLocation, updateReviewLinks } from "@/lib/locations.functions";
import {
  getPlatformWallet,
  recoverStripeTip,
  reviewPlatformWalletPayout,
  updatePlatformWalletSettings,
} from "@/lib/wallet.functions";
import { BrandedQRCode, DashboardShell, WorkspaceSelect, type DashboardNavItem } from "@/components/DashboardShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, CreditCard, LayoutDashboard, MessageSquareText, Settings, ShieldCheck, Users } from "lucide-react";

export const Route = createFileRoute("/dashboard/admin")({
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
type CompanyPage = "overview" | "employees" | "feedback" | "payments" | "settings";
type PlatformPage = "platformOverview" | "platformOrganizations" | "platformUsers" | "platformPayments" | "platformSettings";
type AdminPage = CompanyPage | PlatformPage;
const adminNav: DashboardNavItem<AdminPage>[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "employees", label: "Employees", icon: Users, group: "Manage" },
  { id: "feedback", label: "Ratings & feedback", icon: MessageSquareText },
  { id: "payments", label: "Tips & reconciliation", icon: CreditCard, group: "Money" },
  { id: "settings", label: "Company settings", icon: Settings, group: "Configure" },
];
const platformNav: DashboardNavItem<AdminPage>[] = [
  { id: "platformOverview", label: "Platform overview", icon: ShieldCheck, group: "Administration" },
  { id: "platformOrganizations", label: "Organizations", icon: Building2 },
  { id: "platformUsers", label: "Registered users", icon: Users, group: "Access" },
  { id: "platformPayments", label: "Platform earnings", icon: CreditCard, group: "Money" },
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

  const [data, setData] = useState<Data | null>(null);
  const [companyId, setCompanyId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<AdminPage>("overview");
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

        {page === "overview" && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Tips (all-time)" value={dollars(totals.gross)} />
          <Stat label="Company 10%" value={dollars(totals.company)} />
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

        {page === "settings" && <Section title="Review syndication links (Google / Yelp / Facebook)">
          <ReviewLinksPanel
            companyId={data.company.id}
            companySlug={data.company.slug}
            companyLogo={data.company.logo_url}
            initial={{
              google: data.company.google_review_url ?? "",
              yelp: data.company.yelp_review_url ?? "",
              facebook: data.company.facebook_review_url ?? "",
              threshold: data.company.positive_rating_threshold ?? 4,
              action: data.company.positive_submit_action ?? "success_page",
              redirectUrl: data.company.positive_redirect_url ?? "",
              webhookEnabled: data.company.review_webhook_enabled ?? false,
              webhookUrl: data.company.review_webhook_url ?? "",
            }}
            onSaved={() => load(companyId)}
          />
        </Section>}

        {page === "settings" && <Section title="Automatic thank-you messages">
          <ThankYouTemplatesPanel companyId={data.company.id} />
        </Section>}

        {(page === "overview" || page === "feedback") && <Section title="Recent ratings & feedback">
          <FeedbackList ratings={data.ratings} drivers={data.drivers} />
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

        {page === "payments" && <Section title="Tip disputes & refunds">
          <DisputesPanel
            companyId={data.company.id}
            tips={data.tips}
            drivers={data.drivers}
            onChanged={() => load(companyId)}
          />
        </Section>}

        {page === "payments" && <Section title="Reconciliation (last 30 days)">
          <ReconciliationPanel companyId={data.company.id} drivers={data.drivers} />
        </Section>}

        {page === "employees" && <Section title="SMS a tip link to a customer">
          <AdminSmsPanel drivers={data.drivers} />
        </Section>}

        {isPlatform && data.isSuper && (
          <Section title={pageTitle}>
            <PlatformPanel view={page as PlatformPage} />
          </Section>
        )}
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
  const byDriver = new Map<string, number>();
  for (const t of tips) {
    gross += t.amount_cents;
    company += t.company_amount_cents;
    byDriver.set(t.driver_id, (byDriver.get(t.driver_id) ?? 0) + t.amount_cents);
  }
  return { gross, company, byDriver };
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
          <div className="font-medium">Employee QR codes</div>
          <p className="text-xs text-muted-foreground">
            Each code opens that employee's public rating and tip page.
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
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drivers.map((d) => {
              const path = `/${companySlug}/d/${d.slug}`;
              const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
              return (
                <button
                  key={`qr-${d.id}`}
                  type="button"
                  onClick={() => {
                    setQrDriverId(d.id);
                    setQrFor({ name: d.display_name, url });
                  }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/40"
                  aria-label={`Open QR code for ${d.display_name}`}
                >
                  <span className="shrink-0 rounded-md bg-white p-1.5">
                    <BrandedQRCode value={url} size={76} logoUrl={companyLogo} includeMargin={false} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{d.display_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{path}</span>
                    <span className="mt-1 block text-xs font-medium text-primary">
                      View, download or print QR →
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th className="hidden lg:table-cell">Email</th>
                <th>Status</th>
                <th className="hidden sm:table-cell">Location</th>
                <th className="hidden md:table-cell">Tip link</th>
                <th className="hidden sm:table-cell text-right">Avg ★</th>
                <th className="text-right">Gross tips</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d) => {
                const r = ratingsByDriver.get(d.id);
                const avg = r && r.n ? (r.sum / r.n).toFixed(2) : "—";
                return (
                  <tr key={d.id}>
                    <td className="py-2 font-medium">{d.display_name}</td>
                    <td className="hidden lg:table-cell text-muted-foreground">{d.email || "—"}</td>
                    <td>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{d.status}</span>
                    </td>
                    <td className="hidden sm:table-cell">
                      {locations.length ? (
                        <select
                          value={d.location_id ?? ""}
                          aria-label={`Location for ${d.display_name}`}
                          onChange={async (e) => {
                            const v = e.target.value || null;
                            await setLoc({ data: { driverId: d.id, locationId: v } });
                            onLocationChanged();
                          }}
                          className="max-w-36 rounded-md border border-input bg-background px-2 py-1 text-xs"
                        >
                          <option value="">Not assigned</option>
                          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not assigned</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell">
                      <a
                        className="text-xs text-secondary underline"
                        href={`/${companySlug}/d/${d.slug}`}
                        target="_blank"
                      >
                        /{companySlug}/d/{d.slug}
                      </a>
                    </td>
                    <td className="hidden sm:table-cell text-right">{avg}</td>
                    <td className="text-right">{dollars(tipsByDriver.get(d.id) ?? 0)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setQrDriverId(d.id);
                          setQrFor({
                            name: d.display_name,
                            url: `${window.location.origin}/${companySlug}/d/${d.slug}`,
                          });
                        }}
                        className="mr-2 rounded-md border border-border px-2 py-1 text-xs"
                      >
                        QR / Link
                      </button>
                      <select
                        value={d.status}
                        onChange={(e) => onStatus(d.id, e.target.value as "pending" | "active" | "deactivated")}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      >
                        <option value="pending">pending</option>
                        <option value="active">active</option>
                        <option value="deactivated">deactivated</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
      {qrFor && qrDriverId && (
        <DriverQRModal
          driverId={qrDriverId}
          driverName={qrFor.name}
          url={qrFor.url}
          logoUrl={companyLogo}
          onClose={() => { setQrFor(null); setQrDriverId(null); }}
        />
      )}
    </>
  );
}

function DriverQRModal({ driverId, driverName, url, logoUrl, onClose }: { driverId: string; driverName: string; url: string; logoUrl?: string | null; onClose: () => void }) {
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
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Print, email, or text this link. Use the SMS panel below to send through the platform
            (logs delivery and thank-you flow).
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

function FeedbackList({ ratings, drivers }: { ratings: Data["ratings"]; drivers: Data["drivers"] }) {
  if (!ratings.length) return <div className="text-sm text-muted-foreground">No ratings yet.</div>;
  const byId = new Map(drivers.map((d) => [d.id, d.display_name]));
  return (
    <ul className="divide-y divide-border">
      {ratings.slice(0, 30).map((r) => (
        <li key={r.id} className="py-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-secondary">{"★".repeat(r.stars)}</span>
              <span className="text-muted-foreground">{"★".repeat(5 - r.stars)}</span>
              <span className="ml-2 text-xs text-muted-foreground">{String(byId.get(r.driver_id) ?? "Company")}</span>
              {r.flagged && (
                <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">low rating</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          {r.feedback && <p className="mt-1">{r.feedback}</p>}
          {r.customer_name && <p className="text-xs text-muted-foreground">— {r.customer_name}</p>}
        </li>
      ))}
    </ul>
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
            <select
              value={f.status}
              onChange={(e) => onResolve(f.id, e.target.value as "open" | "resolved" | "violation")}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="violation">violation</option>
            </select>
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
            alert(bits.join("\n"));
            setEmail("");
            setPhone("");
            setName("");
            await reload();
          } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to create invite");
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

function PlatformWalletPanel({ mode }: { mode: "settings" | "requests" }) {
  const getWallet = useServerFn(getPlatformWallet);
  const saveSettings = useServerFn(updatePlatformWalletSettings);
  const reviewPayout = useServerFn(reviewPlatformWalletPayout);
  const recoverPayment = useServerFn(recoverStripeTip);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getPlatformWallet>> | null>(null);
  const [minimum, setMinimum] = useState("25.00");
  const [processingDays, setProcessingDays] = useState("5");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState("");

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

  async function act(requestId: string, action: "approve" | "reject" | "mark_paid") {
    let paymentMethod: string | null = null;
    let paymentReference: string | null = null;
    let note: string | null = null;
    if (action === "mark_paid") {
      paymentMethod = window.prompt("Payment method (bank transfer, Cash App, check, etc.):")?.trim() || null;
      if (!paymentMethod) return;
      paymentReference = window.prompt("Payment reference (optional):")?.trim() || null;
    }
    if (action === "reject") {
      note = window.prompt("Reason for rejection (optional):")?.trim() || null;
    }
    setBusy(true);
    setMessage(null);
    try {
      await reviewPayout({ data: { requestId, action, paymentMethod, paymentReference, note } });
      setMessage(action === "mark_paid" ? "Payout marked paid." : action === "approve" ? "Payout approved." : "Payout rejected.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update payout");
    } finally {
      setBusy(false);
    }
  }

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
      {mode === "requests" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Recover a successful Stripe tip</h3>
        <p className="mt-1 text-xs text-muted-foreground">Use this only when Stripe shows a successful payment but it is missing from Blue Collar Tips.</p>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            const result = await recoverPayment({ data: { paymentIntentId: paymentIntentId.trim() } });
            setMessage(result.alreadyRecorded ? "This Stripe payment was already recorded." : `Recovered ${dollars(result.amountCents)} Stripe tip.`);
            setPaymentIntentId("");
            await reload();
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
      {mode === "requests" && (!wallet ? <p className="mt-4 text-sm text-muted-foreground">Loading payout requests…</p> : wallet.requests.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No payout requests yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border p-4">
          <h3 className="mb-3 font-semibold">Employee payout requests</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr><th className="py-2">Employee</th><th>Company</th><th>Amount</th><th>Status</th><th>Requested</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {wallet.requests.map((request: any) => (
                <tr key={request.id}>
                  <td className="py-3 font-medium">{request.driver_name}</td>
                  <td>{request.company_name}</td>
                  <td>{dollars(Number(request.amount_cents))}</td>
                  <td className="capitalize">{String(request.status)}</td>
                  <td>{new Date(request.requested_at).toLocaleString()}</td>
                  <td className="whitespace-nowrap text-right">
                    {request.status === "pending" && <button disabled={busy} onClick={() => act(request.id, "approve")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Approve</button>}{" "}
                    {["pending", "approved"].includes(request.status) && <button disabled={busy} onClick={() => act(request.id, "reject")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Reject</button>}{" "}
                    {["pending", "approved", "processing"].includes(request.status) && <button disabled={busy} onClick={() => act(request.id, "mark_paid")} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">Mark paid</button>}
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

function ReconciliationPanel({ companyId, drivers }: { companyId: string; drivers: Data["drivers"] }) {
  const fetchOverview = useServerFn(reconciliationOverview);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof reconciliationOverview>>["rows"]>([]);
  const byId = new Map(drivers.map((d) => [d.id, d.display_name]));
  useEffect(() => {
    fetchOverview({ data: { companyId } }).then((r) => setRows(r.rows));
  }, [companyId, fetchOverview]);
  if (!rows.length) return <div className="text-sm text-muted-foreground">No tip activity in last 30 days.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr><th className="py-2">Employee</th><th>Total tips</th><th className="hidden sm:table-cell">Manual</th><th>Unverified</th><th className="hidden sm:table-cell">Unverified $</th><th>Unverified %</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.driverId} className={r.unverifiedPct > 20 ? "bg-destructive/5" : undefined}>
              <td className="py-2 font-medium">{String(byId.get(r.driverId) ?? "—")}</td>
              <td>{r.total}</td>
              <td className="hidden sm:table-cell">{r.manual}</td>
              <td>{r.unverified}</td>
              <td className="hidden sm:table-cell">{dollars(r.amountUnverified)}</td>
              <td className={r.unverifiedPct > 20 ? "font-semibold text-destructive" : ""}>{r.unverifiedPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Employees above 20% unverified are highlighted; consider following up.
      </p>
    </div>
  );
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
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm">
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}
        </select>
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
  return (
    <div className="space-y-4">
      {view === "platformPayments" && <PlatformWalletPanel mode="requests" />}
      {view === "platformSettings" && <PlatformWalletPanel mode="settings" />}
      {view === "platformOverview" && <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Gross tips" value={dollars(data.grossTotal)} />
        <Stat label="Platform 10%" value={dollars(data.platformTotal)} />
        <Stat label="Tenants" value={String(data.tenants.length)} />
        <Stat label="Employees" value={String(data.driverCount)} />
        <Stat label="Registered users" value={String(data.userCount)} />
      </div>}
      {view === "platformPayments" && <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gross tips" value={dollars(data.grossTotal)} />
        <Stat label="Platform fees earned" value={dollars(data.platformTotal)} />
        <Stat label="Tips processed" value={String(data.tips.length)} />
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Organization fee breakdown</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Organization</th><th>Tips</th><th>Gross</th><th>Company share</th><th>Platform fees</th></tr></thead><tbody className="divide-y divide-border">
            {data.tenants.map((tenant) => <tr key={tenant.id}><td className="py-2 font-medium">{tenant.name}</td><td>{tenant.count}</td><td>{dollars(tenant.gross)}</td><td>{dollars(tenant.companyShare)}</td><td>{dollars(tenant.platformShare)}</td></tr>)}
          </tbody></table>
        </div>
      </div>}
      {view === "platformPayments" && <div className="rounded-lg border border-border p-4">
        <h3 className="font-semibold">Employee earnings breakdown</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2">Employee</th><th>Email</th><th>Company</th><th>Tips</th><th>Gross</th><th>Platform share</th></tr></thead><tbody className="divide-y divide-border">
            {data.employees.map((employee) => <tr key={employee.id}><td className="py-2 font-medium">{employee.display_name}</td><td>{employee.email || "—"}</td><td>{Array.isArray(employee.companies) ? employee.companies[0]?.name : employee.companies?.name}</td><td>{employee.count}</td><td>{dollars(employee.gross)}</td><td>{dollars(employee.platformShare)}</td></tr>)}
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
              <tr key={t.id}>
                <td className="py-2 font-medium">{t.name}</td>
                <td><span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{t.status}</span></td>
                <td className="hidden sm:table-cell">{t.count}</td>
                <td>{dollars(t.gross)}</td>
                <td className="hidden md:table-cell">{dollars(t.companyShare)}</td>
                <td className="hidden md:table-cell">{dollars(t.platformShare)}</td>
                <td className="hidden lg:table-cell">{dollars(t.pendingCompany)}</td>
                <td className="text-right">
                  <button
                    onClick={async () => {
                      await suspend({ data: { companyId: t.id, status: t.status === "active" ? "suspended" : "active" } });
                      await reload();
                    }}
                    className="rounded border border-border px-2 py-1 text-xs"
                  >
                    {t.status === "active" ? "Suspend" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

function ThankYouTemplatesPanel({ companyId }: { companyId: string }) {
  const get = useServerFn(getThankYouTemplates);
  const save = useServerFn(updateThankYouTemplates);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [sms, setSms] = useState("");
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    get({ data: { companyId } }).then((r) => {
      if (r) {
        setEnabled(r.thank_you_enabled);
        setSms(r.thank_you_sms_template);
        setSubject(r.thank_you_email_subject);
        setEmailBody(r.thank_you_email_template);
      }
      setLoading(false);
    });
  }, [companyId, get]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading templates…</div>;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setSaved(false);
        try {
          await save({
            data: {
              companyId,
              enabled,
              smsTemplate: sms,
              emailSubject: subject,
              emailTemplate: emailBody,
            },
          });
          setSaved(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        Sent automatically when a customer leaves a rating and provides a phone or email.
        Available placeholders: <code>{"{{customer_name}}"}</code>, <code>{"{{employee_name}}"}</code>,
        <code>{"{{company_name}}"}</code>, <code>{"{{stars}}"}</code>, <code>{"{{tip_amount}}"}</code>,
        <code>{"{{tip_line}}"}</code>.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Send thank-you messages
      </label>
      <div>
        <div className="text-sm font-medium">SMS template</div>
        <textarea
          rows={3}
          value={sms}
          onChange={(e) => setSms(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          maxLength={800}
        />
      </div>
      <div>
        <div className="text-sm font-medium">Email subject</div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          maxLength={200}
        />
      </div>
      <div>
        <div className="text-sm font-medium">Email body</div>
        <textarea
          rows={6}
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          maxLength={4000}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save templates"}
        </button>
        {saved && <span className="text-xs text-muted-foreground">Saved.</span>}
      </div>
    </form>
  );
}

function LocationsPanel({ companyId }: { companyId: string }) {
  const list = useServerFn(listLocations);
  const create = useServerFn(createLocation);
  const del = useServerFn(deleteLocation);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listLocations>>>([]);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
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
              <button
                onClick={async () => { if (confirm(`Delete location "${l.name}"?`)) { await del({ data: { locationId: l.id } }); await reload(); } }}
                className="rounded border border-border px-2 py-1 text-xs"
              >Delete</button>
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
  initial: { google: string; yelp: string; facebook: string; threshold: number; action: "success_page" | "redirect"; redirectUrl: string; webhookEnabled: boolean; webhookUrl: string };
  onSaved: () => void;
}) {
  const save = useServerFn(updateReviewLinks);
  const [google, setGoogle] = useState(initial.google);
  const [yelp, setYelp] = useState(initial.yelp);
  const [facebook, setFacebook] = useState(initial.facebook);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [action, setAction] = useState(initial.action);
  const [redirectUrl, setRedirectUrl] = useState(initial.redirectUrl);
  const [webhookEnabled, setWebhookEnabled] = useState(initial.webhookEnabled);
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl);
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
              positiveRatingThreshold: threshold,
              positiveSubmitAction: action,
              positiveRedirectUrl: redirectUrl.trim() || null,
              reviewWebhookEnabled: webhookEnabled,
              reviewWebhookUrl: webhookUrl.trim() || null,
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
      <label className="text-sm">Positive rating threshold
        <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">
          <option value={4}>4 stars and above</option><option value={5}>5 stars only</option>
        </select>
      </label>
      <label className="text-sm">After a positive submission
        <select value={action} onChange={(e) => setAction(e.target.value as "success_page" | "redirect")} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">
          <option value="success_page">Show success page</option><option value="redirect">Redirect to a link</option>
        </select>
      </label>
      {action === "redirect" && <div className="sm:col-span-2"><Input label="Redirect URL" value={redirectUrl} onChange={setRedirectUrl} placeholder="https://g.page/r/…/review" required /></div>}
      <div className="sm:col-span-2 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} />
          Send submitted ratings to this company’s webhook
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="Submission webhook URL" value={webhookUrl} onChange={setWebhookUrl} placeholder="https://services.leadconnectorhq.com/hooks/…" required={webhookEnabled} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Requests include an HMAC-SHA256 signature managed by the server environment. Webhooks remain off until enabled.</p>
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
          {busy ? "Saving…" : "Save review links"}
        </button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        <span className="text-xs text-muted-foreground">Positive customers follow the action configured above.</span>
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
          <select
            value={tipId}
            onChange={(e) => setTipId(e.target.value)}
            className="mt-1 block max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Select a tip…</option>
            {openTips.map((t) => (
              <option key={t.id} value={t.id}>
                {dollars(t.amount_cents)} · {byId.get(t.driver_id) ?? "—"} · {t.source} ·{" "}
                {new Date(t.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
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
                              const input = window.prompt(
                                `Refund amount in dollars (max ${(t.amount_cents / 100).toFixed(2)}):`,
                                (t.amount_cents / 100).toFixed(2),
                              );
                              if (input === null) return;
                              const cents = Math.round(Number(input) * 100);
                              if (!Number.isFinite(cents) || cents <= 0) {
                                setMsg("Enter a valid refund amount.");
                                return;
                              }
                              run(
                                () =>
                                  refund({
                                    data: {
                                      tipId: t.id,
                                      amountCents: cents,
                                      reason: t.dispute_reason ?? undefined,
                                    },
                                  }),
                                "Refund issued — employee and customer notified.",
                              );
                            }}
                            className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground disabled:opacity-60"
                          >
                            Refund
                          </button>
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
