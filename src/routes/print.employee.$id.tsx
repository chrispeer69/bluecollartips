import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeCanvas } from "qrcode.react";
import { z } from "zod";
import { getPayoutStatement } from "@/lib/payouts.functions";
import { getDriverDashboard } from "@/lib/driver.functions";
import { dollars } from "@/lib/constants";

const searchSchema = z.object({
  mode: z.enum(["poster", "statement"]).default("poster"),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const Route = createFileRoute("/print/employee/$id")({
  head: () => ({
    meta: [
      { title: "Print — Blue Collar Tips" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: PrintPage,
});

function PrintPage() {
  const { id } = useParams({ from: "/print/employee/$id" });
  const search = useSearch({ from: "/print/employee/$id" });
  const dash = useServerFn(getDriverDashboard);
  const payout = useServerFn(getPayoutStatement);
  const [driver, setDriver] = useState<{ display_name: string; slug: string; companies?: { name: string; slug: string; logo_url: string | null; primary_color: string | null } | null } | null>(null);
  const [statement, setStatement] = useState<Awaited<ReturnType<typeof getPayoutStatement>> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await dash({ data: { driverId: id } });
      setDriver(d.driver as unknown as typeof driver extends null ? never : Parameters<typeof setDriver>[0]);
      if (search.mode === "statement") {
        const s = await payout({ data: { driverId: id, from: search.from, to: search.to } });
        setStatement(s);
      }
      setReady(true);
      setTimeout(() => window.print(), 400);
    })();
  }, [id, search.mode, search.from, search.to, dash, payout]);

  if (!ready || !driver) {
    return <div className="grid min-h-screen place-items-center">Preparing print view…</div>;
  }

  const co = driver.companies;
  const tipUrl = typeof window !== "undefined" ? `${window.location.origin}/${co?.slug}/d/${driver.slug}` : "";
  const brand = co?.primary_color || "#0b2545";

  if (search.mode === "poster") {
    return (
      <div className="min-h-screen bg-white p-10 text-black print:p-6" style={{ fontFamily: "system-ui, sans-serif" }}>
        <style>{`@media print { @page { size: letter; margin: 0.5in; } }`}</style>
        <div className="mx-auto max-w-[7.5in] rounded-2xl border-4 p-10 text-center" style={{ borderColor: brand }}>
          {co?.logo_url ? (
            <img src={co.logo_url} alt={co.name} className="mx-auto h-20 object-contain" />
          ) : (
            <div className="text-xl font-bold uppercase tracking-widest" style={{ color: brand }}>{co?.name}</div>
          )}
          <h1 className="mt-6 text-5xl font-black" style={{ color: brand }}>Rate & tip your service pro</h1>
          <p className="mt-3 text-lg text-gray-700">Scan the code to leave a rating and tip {driver.display_name}.</p>
          <div className="mx-auto mt-8 inline-block rounded-lg border-2 border-gray-200 p-4">
            <QRCodeCanvas value={tipUrl} size={340} includeMargin />
          </div>
          <div className="mt-4 text-lg font-semibold">{driver.display_name}</div>
          <div className="mt-1 break-all text-sm text-gray-600">{tipUrl}</div>
          <ol className="mx-auto mt-8 max-w-md space-y-2 text-left text-base text-gray-800">
            <li><b>1.</b> Open your phone's camera.</li>
            <li><b>2.</b> Point it at the QR code above.</li>
            <li><b>3.</b> Tap the link to rate and tip.</li>
          </ol>
          <div className="mt-8 text-xs text-gray-500">Powered by Blue Collar Tips</div>
        </div>
      </div>
    );
  }

  // statement mode
  const s = statement!;
  return (
    <div className="min-h-screen bg-white p-10 text-black print:p-6" style={{ fontFamily: "system-ui, sans-serif" }}>
      <style>{`@media print { @page { size: letter; margin: 0.5in; } }`}</style>
      <div className="mx-auto max-w-[7.5in]">
        <div className="flex items-center justify-between border-b-2 pb-4" style={{ borderColor: brand }}>
          <div>
            <div className="text-xs uppercase tracking-widest text-gray-500">{s.driver.company}</div>
            <h1 className="text-2xl font-bold">Payout statement — {s.driver.name}</h1>
            <div className="text-xs text-gray-500">
              {s.range.from ? `From ${s.range.from.slice(0, 10)} ` : ""}
              {s.range.to ? `To ${s.range.to.slice(0, 10)}` : "All-time"}
            </div>
          </div>
          {co?.logo_url && <img src={co.logo_url} alt="" className="h-12 object-contain" />}
        </div>
        <div className="mt-6 grid grid-cols-4 gap-2 text-center text-sm">
          <Cell label="Gross tips" v={dollars(s.totals.gross)} />
          <Cell label="Employee 80%" v={dollars(s.totals.driver)} />
          <Cell label="Company 10%" v={dollars(s.totals.company)} />
          <Cell label="Platform 10%" v={dollars(s.totals.platform)} />
        </div>
        <table className="mt-6 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b bg-gray-50 text-left">
              <th className="p-2">Date</th>
              <th className="p-2">Source</th>
              <th className="p-2">Customer</th>
              <th className="p-2 text-right">Gross</th>
              <th className="p-2 text-right">Employee</th>
              <th className="p-2 text-right">Company</th>
              <th className="p-2 text-right">Platform</th>
              <th className="p-2">Verified</th>
            </tr>
          </thead>
          <tbody>
            {s.tips.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="p-2">{new Date(t.created_at).toLocaleDateString()}</td>
                <td className="p-2 capitalize">{t.source}</td>
                <td className="p-2">{t.customer_name ?? "—"}</td>
                <td className="p-2 text-right">{dollars(t.amount_cents)}</td>
                <td className="p-2 text-right">{dollars(t.driver_amount_cents)}</td>
                <td className="p-2 text-right">{dollars(t.company_amount_cents)}</td>
                <td className="p-2 text-right">{dollars(t.platform_amount_cents)}</td>
                <td className="p-2">{t.verified ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.tips.length === 0 && <div className="mt-6 text-center text-sm text-gray-500">No tips in this range.</div>}
        <div className="mt-8 text-xs text-gray-500">Generated by Blue Collar Tips · {new Date().toLocaleString()}</div>
      </div>
    </div>
  );
}

function Cell({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{v}</div>
    </div>
  );
}