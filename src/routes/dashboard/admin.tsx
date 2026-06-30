import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  createCompany,
  createDriver,
  getAdminDashboard,
  resolveFlag,
  setDriverStatus,
  updateCompanyBranding,
} from "@/lib/admin.functions";
import { dollars } from "@/lib/constants";
import { Section, Stat, TopBar } from "./driver";

export const Route = createFileRoute("/dashboard/admin")({
  head: () => ({ meta: [{ title: "Admin — Blue Collar AI" }] }),
  component: AdminDashboard,
});

type Data = Awaited<ReturnType<typeof getAdminDashboard>>;

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

  async function load(id?: string) {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      navigate({ to: "/auth" });
      return;
    }
    const d = await get({ data: { companyId: id } });
    setData(d);
    if (d.company) setCompanyId(d.company.id);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Center>Loading…</Center>;
  if (!data?.company) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Blue Collar AI" subtitle="Super admin" onSignOut={signOut(navigate)} />
        <div className="mx-auto max-w-3xl p-6">
          <NewCompanyForm onCreate={async (v) => {
            const r = await newCo({ data: v });
            alert(`Company created. Admin invite code: ${r.inviteCode}`);
            await load(r.companyId);
          }} />
        </div>
      </div>
    );
  }

  const totals = sumTips(data.tips);
  const ratingStats = ratingAgg(data.ratings, data.drivers);

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        title={data.company.name}
        subtitle={data.isSuper ? "Blue Collar AI · Super admin" : "Company admin"}
        onSignOut={signOut(navigate)}
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {data.isSuper && data.companies && data.companies.length > 0 && (
          <Section title="Tenant">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setLoading(true);
                  load(e.target.value);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <NewCompanyInline
                onCreate={async (v) => {
                  const r = await newCo({ data: v });
                  alert(`Company created. Admin invite code: ${r.inviteCode}`);
                  await load(r.companyId);
                }}
              />
            </div>
          </Section>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Tips (all-time)" value={dollars(totals.gross)} />
          <Stat label="Company 10%" value={dollars(totals.company)} />
          <Stat label="Drivers" value={String(data.drivers.length)} />
          <Stat label="Avg rating" value={ratingStats.avg ? ratingStats.avg.toFixed(2) + " ★" : "—"} />
        </div>

        <Section title="Drivers">
          <DriverRoster
            drivers={data.drivers}
            ratingsByDriver={ratingStats.byDriver}
            tipsByDriver={totals.byDriver}
            onCreate={async (v) => {
              const r = await createDrv({ data: { ...v, companyId: data.company!.id } });
              alert(`Driver created. Invite code (send to driver): ${r.inviteCode}`);
              await load(companyId);
            }}
            onStatus={async (driverId, status) => {
              await setStatus({ data: { driverId, status } });
              await load(companyId);
            }}
            companySlug={data.company.slug}
          />
        </Section>

        <Section title="Branding">
          <BrandingForm
            initial={data.company}
            onSave={async (v) => {
              await updateCo({ data: { ...v, companyId: data.company!.id } });
              await load(companyId);
            }}
          />
        </Section>

        <Section title="Recent ratings & feedback">
          <FeedbackList ratings={data.ratings} drivers={data.drivers} />
        </Section>

        <Section title="Discrepancy flags">
          <FlagsList
            flags={data.flags}
            drivers={data.drivers}
            onResolve={async (id, status, notes) => {
              await fixFlag({ data: { flagId: id, status, notes } });
              await load(companyId);
            }}
          />
        </Section>
      </div>
    </div>
  );
}

function signOut(nav: ReturnType<typeof useNavigate>) {
  return async () => {
    await supabase.auth.signOut();
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
}: {
  drivers: Data["drivers"];
  ratingsByDriver: Map<string, { sum: number; n: number }>;
  tipsByDriver: Map<string, number>;
  onCreate: (v: { displayName: string; email?: string | null; phone?: string | null; employeeId?: string | null }) => Promise<void>;
  onStatus: (id: string, s: "pending" | "active" | "deactivated") => Promise<void>;
  companySlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [empId, setEmpId] = useState("");
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setOpen((v) => !v)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          {open ? "Cancel" : "Add driver"}
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
          <Input label="Email" value={email} onChange={setEmail} type="email" />
          <Input label="Phone" value={phone} onChange={setPhone} />
          <Input label="Employee ID" value={empId} onChange={setEmpId} />
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create & generate invite</button>
          </div>
        </form>
      )}
      {drivers.length === 0 ? (
        <div className="text-sm text-muted-foreground">No drivers yet. Add one to get started.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th>Status</th>
                <th>Tip link</th>
                <th className="text-right">Avg ★</th>
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
                    <td>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{d.status}</span>
                    </td>
                    <td>
                      <a
                        className="text-xs text-secondary underline"
                        href={`/${companySlug}/d/${d.slug}`}
                        target="_blank"
                      >
                        /{companySlug}/d/{d.slug}
                      </a>
                    </td>
                    <td className="text-right">{avg}</td>
                    <td className="text-right">{dollars(tipsByDriver.get(d.id) ?? 0)}</td>
                    <td className="text-right">
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
      )}
    </>
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
              <span className="ml-2 text-xs text-muted-foreground">{byId.get(r.driver_id)}</span>
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
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{byId.get(f.driver_id) ?? "Driver"}</span>
              <span className="ml-2 text-muted-foreground">{f.reason}</span>
            </div>
            <select
              value={f.status}
              onChange={(e) => onResolve(f.id, e.target.value as "open" | "resolved" | "violation")}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
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
        As the platform super admin, create your first towing company tenant.
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}