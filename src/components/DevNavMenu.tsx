import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getDevSampleDriver } from "@/lib/dev-tenant.functions";

// DEV ONLY: floating nav so the developer can hit every page in one click,
// with no auth/role friction. Pairs with ensureDevSession() (auto super-admin).
export function DevNavMenu() {
  const sampleFn = useServerFn(getDevSampleDriver);
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<{ companySlug: string; driverSlug: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await sampleFn();
        if (res?.companySlug && res?.driverSlug) setSample(res);
      } catch {
        /* ignore — dev session may not be ready yet */
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [sampleFn]);

  const linkCls =
    "block px-3 py-2 rounded text-sm hover:bg-amber-100 text-slate-800 no-underline";

  return (
    <div className="fixed bottom-4 left-4 z-[9999] font-sans">
      {open ? (
        <div className="bg-white border-2 border-amber-500 rounded-lg shadow-xl w-64 p-2">
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-amber-200">
            <span className="text-xs font-bold text-amber-700">🛠 DEV NAV</span>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-900 text-sm"
            >
              ✕
            </button>
          </div>
          <Link to="/" className={linkCls} onClick={() => setOpen(false)}>
            Landing (/)
          </Link>
          <Link to="/auth" className={linkCls} onClick={() => setOpen(false)}>
            Auth (/auth)
          </Link>
          <Link to="/dashboard" className={linkCls} onClick={() => setOpen(false)}>
            Dashboard router
          </Link>
          <Link to="/dashboard/admin" className={linkCls} onClick={() => setOpen(false)}>
            Admin dashboard
          </Link>
          <Link to="/dashboard/driver" className={linkCls} onClick={() => setOpen(false)}>
            Driver dashboard
          </Link>
          {sample ? (
            <Link
              to="/$companySlug/d/$driverSlug"
              params={{ companySlug: sample.companySlug, driverSlug: sample.driverSlug }}
              className={linkCls}
              onClick={() => setOpen(false)}
            >
              Public tip page (sample)
            </Link>
          ) : (
            <span className="block px-3 py-2 text-xs text-slate-400">
              No driver yet — create one in Admin
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-3 py-2 rounded-full shadow-lg"
        >
          🛠 DEV NAV
        </button>
      )}
    </div>
  );
}