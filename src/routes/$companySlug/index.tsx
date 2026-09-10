import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicCompany, submitCompanyRating } from "@/lib/public.functions";
import { StripeCardPanel } from "@/components/StripeCardPanel";
import { PRESET_TIPS, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";

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
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompany({ data: { companySlug, reviewToken } }).then((result) => {
      setCompany(result);
      if (result?.reviewContact) {
        setCustomerName(result.reviewContact.name ?? "");
        setCustomerPhone(result.reviewContact.phone ?? "");
        const email = result.reviewContact.email ?? "";
        setCustomerEmail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "");
      }
    }).finally(() => setLoading(false));
  }, [companySlug, getCompany, reviewToken]);
  const brand = useMemo(() => ({ primary: company?.primary_color || "#0b2545", secondary: company?.secondary_color || "#f59e0b" }), [company]);
  const customTipCents = Math.round(Number.parseFloat(customTip || "0") * 100);
  const finalTipCents = tipCents ?? (Number.isFinite(customTipCents) ? customTipCents : 0);
  const tipValid = finalTipCents === 0 || (finalTipCents >= TIP_MIN_CENTS && finalTipCents <= TIP_MAX_CENTS);
  if (loading) return <div className="grid min-h-screen place-items-center">Loading…</div>;
  if (!company) return <div className="grid min-h-screen place-items-center">Link not active</div>;
  if (done) return <div className="grid min-h-screen place-items-center px-6 text-center" style={{ background: brand.primary, color: "white" }}><div><h1 className="text-3xl font-bold">Thank you!</h1><p className="mt-3">Your feedback helps {company.name} keep raising the bar.</p></div></div>;

  return <div className="min-h-screen bg-background">
    <header className="px-5 py-6 text-white" style={{ background: brand.primary }}>
      <div className="mx-auto max-w-md">{company.logo_url && <img src={company.logo_url} alt={company.name} className="mb-3 h-12" />}<div className="text-xl font-semibold">{company.name}</div></div>
    </header>
    <form className="mx-auto max-w-md space-y-5 px-5 py-6" onSubmit={async (e) => {
      e.preventDefault(); setError(null); if (!stars) { setError("Please tap a star rating."); return; }
      if (customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) { setError("Please enter a valid email address."); return; }
      if (!tipValid) { setError(`Tip must be between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`); return; }
      if (finalTipCents > 0) { setError("Use the secure payment button above to finish your tip."); return; }
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
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Leave a tip (optional)</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your tip supports the {company.name} team.</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {PRESET_TIPS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => { setTipCents(c); setCustomTip(""); setCustomTipOpen(false); setError(null); }}
              className="rounded-md border px-2 py-3 text-sm font-medium"
              style={tipCents === c ? { background: brand.secondary, color: "white", borderColor: brand.secondary } : undefined}
            >
              ${(c / 100).toFixed(0)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setTipCents(null); setCustomTip(""); setCustomTipOpen(true); setError(null); }}
            className="rounded-md border px-2 py-3 text-sm font-medium"
            style={customTipOpen ? { background: brand.secondary, color: "white", borderColor: brand.secondary } : undefined}
          >
            Custom
          </button>
        </div>
        {customTipOpen && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              autoFocus
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={customTip}
              onChange={(e) => { setCustomTip(e.target.value); setTipCents(null); setError(null); }}
              placeholder="Enter tip amount"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        )}
        {finalTipCents > 0 && (
          <>
            {tipValid && stars > 0 && (!customerEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) && (
              <StripeCardPanel
                companySlug={companySlug}
                amountCents={finalTipCents}
                customerName={customerName || null}
                customerPhone={customerPhone || null}
                customerEmail={customerEmail || null}
                stars={stars || null}
                brandColor={brand.primary}
                onPaid={async () => {
                  try {
                    const result = await submit({ data: {
                      companySlug,
                      stars,
                      feedback: feedback.trim() || null,
                      customerName: customerName.trim() || null,
                      customerPhone: customerPhone.trim() || null,
                      customerEmail: customerEmail.trim() || null,
                      reviewToken,
                    } });
                    if (result.redirectUrl) { window.location.assign(result.redirectUrl); return; }
                  } catch { /* The payment is still safely recorded by Stripe's webhook. */ }
                  setDone(true);
                }}
              />
            )}
            {!stars && <p className="mt-3 text-sm text-muted-foreground">Choose a star rating to continue to payment.</p>}
            <button
              type="button"
              onClick={() => { setTipCents(null); setCustomTip(""); setCustomTipOpen(false); setError(null); }}
              className="mt-3 text-sm text-muted-foreground underline"
            >
              Continue without a tip
            </button>
          </>
        )}
      </section>
      {error && <p className="text-sm text-destructive">{error}</p>}{finalTipCents === 0 && <button disabled={busy} className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Submitting…" : "Submit feedback"}</button>}
    </form>
  </div>;
}

function Field({ label, value, setValue, type = "text" }: { label: string; value: string; setValue: (value: string) => void; type?: string }) {
  return <label className="block text-sm font-medium">{label}<input type={type} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>;
}
