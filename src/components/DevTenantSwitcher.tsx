import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ensureRoadsideTowing, listDevTenants } from "@/lib/dev-tenant.functions";

// DEV ONLY: floating widget to impersonate / switch tenants quickly.
// Persists selection in localStorage("devTenantId"); admin dashboard reads it.
const STORAGE_KEY = "devTenantId";

export function DevTenantSwitcher() {
  const list = useServerFn(listDevTenants);
  const seedRoadside = useServerFn(ensureRoadsideTowing);

  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await list();
      if (!r.isSuper) {
        setTenants([]);
        return;
      }
      setTenants(r.companies);
      const stored = localStorage.getItem(STORAGE_KEY) ?? "";
      if (stored && r.companies.some((c) => c.id === stored)) setCurrent(stored);
      else if (r.companies[0]) setCurrent(r.companies[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants");
    }
  }

  useEffect(() => {
    // Wait a beat so dev auto-login can finish first.
    const t = setTimeout(refresh, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchTo(id: string) {
    localStorage.setItem(STORAGE_KEY, id);
    setCurrent(id);
    // Hard reload to /dashboard/admin so the dashboard picks up the new tenant.
    window.location.assign("/dashboard/admin");
  }

  async function seedAndSwitch() {
    setBusy(true);
    setError(null);
    try {
      const r = await seedRoadside();
      await refresh();
      switchTo(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to seed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-3 right-3 z-[9999] font-mono text-xs">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-amber-200 shadow-lg backdrop-blur hover:bg-amber-500/20"
          title="Dev tenant switcher"
        >
          🛠 DEV · {tenants.find((t) => t.id === current)?.name ?? "no tenant"}
        </button>
      ) : (
        <div className="w-72 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-amber-300">DEV · Tenant impersonation</span>
            <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-100">✕</button>
          </div>
          {error && <p className="mb-2 text-rose-400">{error}</p>}
          {tenants.length === 0 ? (
            <p className="text-zinc-400">No tenants yet (or not super admin).</p>
          ) : (
            <ul className="mb-2 max-h-56 space-y-1 overflow-auto">
              {tenants.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => switchTo(t.id)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-zinc-800 ${
                      t.id === current ? "bg-amber-500/15 text-amber-200" : ""
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="ml-2 text-[10px] text-zinc-500">/{t.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={seedAndSwitch}
              disabled={busy}
              className="flex-1 rounded border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {busy ? "Working…" : "Seed “Roadside Towing”"}
            </button>
            <button
              onClick={refresh}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">
            Visible in dev mode only. Switching reloads the admin dashboard for the chosen tenant.
          </p>
        </div>
      )}
    </div>
  );
}