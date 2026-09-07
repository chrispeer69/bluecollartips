import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicCompany, submitCompanyRating } from "@/lib/public.functions";

export const Route = createFileRoute("/$companySlug/")({
  validateSearch: (search: Record<string, unknown>) => ({ t: typeof search.t === "string" ? search.t : undefined }),
  component: CompanyReviewPage,
});

function CompanyReviewPage() {
  const { companySlug } = useParams({ from: "/$companySlug/" });
  const { t: reviewToken } = Route.useSearch();
  const getCompany = useServerFn(getPublicCompany);
  const submit = useServerFn(submitCompanyRating);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompany({ data: { companySlug, reviewToken } }).then((result) => {
      setCompany(result);
      if (result?.reviewContact) {
        setCustomerName(result.reviewContact.name ?? "");
        setCustomerPhone(result.reviewContact.phone ?? "");
        setCustomerEmail(result.reviewContact.email ?? "");
      }
    }).finally(() => setLoading(false));
  }, [companySlug, getCompany, reviewToken]);
  const brand = useMemo(() => ({ primary: company?.primary_color || "#0b2545", secondary: company?.secondary_color || "#f59e0b" }), [company]);
  if (loading) return <div className="grid min-h-screen place-items-center">Loading…</div>;
  if (!company) return <div className="grid min-h-screen place-items-center">Link not active</div>;
  if (done) return <div className="grid min-h-screen place-items-center px-6 text-center" style={{ background: brand.primary, color: "white" }}><div><h1 className="text-3xl font-bold">Thank you!</h1><p className="mt-3">Your feedback helps {company.name} keep raising the bar.</p></div></div>;

  return <div className="min-h-screen bg-background">
    <header className="px-5 py-6 text-white" style={{ background: brand.primary }}>
      <div className="mx-auto max-w-md">{company.logo_url && <img src={company.logo_url} alt={company.name} className="mb-3 h-12" />}<div className="text-xl font-semibold">{company.name}</div></div>
    </header>
    <form className="mx-auto max-w-md space-y-5 px-5 py-6" onSubmit={async (e) => {
      e.preventDefault(); setError(null); if (!stars) { setError("Please tap a star rating."); return; }
      setBusy(true);
      try {
        const result = await submit({ data: { companySlug, stars, feedback: feedback.trim() || null, customerName: customerName.trim() || null, customerPhone: customerPhone.trim() || null, customerEmail: customerEmail.trim() || null, reviewToken } });
        if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
        setDone(true);
      } catch (err) { setError(err instanceof Error ? err.message : "Could not submit"); } finally { setBusy(false); }
    }}>
      <section className="rounded-xl border border-border bg-card p-5"><h1 className="text-lg font-semibold">How did we do?</h1><div className="mt-3 flex justify-between">{[1,2,3,4,5].map((n) => <button type="button" key={n} onClick={() => setStars(n)} className="p-1 text-4xl" style={{ color: stars >= n ? brand.secondary : "var(--muted-foreground)" }} aria-label={`${n} stars`}>★</button>)}</div>
      <label className="mt-5 block text-sm font-medium">Anything you'd like to share?</label><textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} maxLength={2000} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></section>
      <section className="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-2"><Field label="Your name" value={customerName} setValue={setCustomerName} /><Field label="Phone" value={customerPhone} setValue={setCustomerPhone} /><div className="sm:col-span-2"><Field label="Email" value={customerEmail} setValue={setCustomerEmail} type="email" /></div></section>
      {error && <p className="text-sm text-destructive">{error}</p>}<button disabled={busy} className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Submitting…" : "Submit feedback"}</button>
    </form>
  </div>;
}

function Field({ label, value, setValue, type = "text" }: { label: string; value: string; setValue: (value: string) => void; type?: string }) {
  return <label className="block text-sm font-medium">{label}<input type={type} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>;
}
