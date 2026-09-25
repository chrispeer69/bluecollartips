import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicCompany, submitCompanyRating } from "@/lib/public.functions";
import { StripeCardPanel } from "@/components/StripeCardPanel";
import { PRESET_TIPS, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";
import { Check, Copy } from "lucide-react";
import { ReviewQualityPicker } from "@/components/ReviewQualityPicker";
import { ReviewThankYou } from "@/components/ReviewThankYou";
import {
  REVIEW_QUALITIES,
  composeReviewSentence,
} from "@/lib/review-suggestions";

// Company-level rating page: reached when dispatch could not match a driver,
// or from the company's general QR/link. Mirrors the driver page's design so
// these customers get the same tip pitch — the tip is held as a company tip
// until an admin attributes it.

export const Route = createFileRoute("/$companySlug/")({
  validateSearch: (search: Record<string, unknown>) => ({ t: typeof search.t === "string" ? search.t : undefined }),
  component: CompanyReviewPage,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Sky blue used to draw attention to the tip box and submit button.
const SKY = "#0ea5e9";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "";
}

function CompanyReviewPage() {
  const { companySlug } = useParams({ from: "/$companySlug/" });
  const { t: reviewToken } = Route.useSearch();
  const getCompany = useServerFn(getPublicCompany);
  const submit = useServerFn(submitCompanyRating);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [selectedQualities, setSelectedQualities] = useState<string[]>([]);
  const [reviewCopied, setReviewCopied] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  // Name/phone already known from the tracked review link — don't ask again.
  const [knownName, setKnownName] = useState(false);
  const [knownPhone, setKnownPhone] = useState(false);
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [positiveRedirectUrl, setPositiveRedirectUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompany({ data: { companySlug, reviewToken } }).then((result) => {
      setCompany(result);
      if (result?.reviewContact) {
        const name = (result.reviewContact.name ?? "").trim();
        const phone = (result.reviewContact.phone ?? "").trim();
        setCustomerName(name);
        setCustomerPhone(phone);
        setKnownName(!!name);
        setKnownPhone(!!phone);
        const email = result.reviewContact.email ?? "";
        setCustomerEmail(EMAIL_RE.test(email) ? email : "");
      }
    }).finally(() => setLoading(false));
  }, [companySlug, getCompany, reviewToken]);

  const brand = useMemo(() => ({ primary: company?.primary_color || "#0b2545", secondary: company?.secondary_color || "#f59e0b" }), [company]);
  const customTipCents = Math.round(Number.parseFloat(customTip || "0") * 100);
  const finalTipCents = tipCents ?? (Number.isFinite(customTipCents) ? customTipCents : 0);
  const tipValid = finalTipCents === 0 || (finalTipCents >= TIP_MIN_CENTS && finalTipCents <= TIP_MAX_CENTS);
  const emailOk = !customerEmail.trim() || EMAIL_RE.test(customerEmail.trim());
  function toggleQuality(id: string) {
    const next = selectedQualities.includes(id)
      ? selectedQualities.filter((qualityId) => qualityId !== id)
      : [...selectedQualities, id];
    setSelectedQualities(next);
    setFeedback(composeReviewSentence("My driver", next));
    setReviewCopied(false);
  }

  async function copyFeedbackForReview() {
    const copied = await copyReviewText(feedback);
    if (!copied) {
      setError("Could not copy automatically. Press and hold your feedback to copy it.");
      return;
    }
    setError(null);
    setReviewCopied(true);
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Loading…</div>;
  if (!company) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Link not active</h1>
          <p className="mt-2 text-sm text-muted-foreground">This link isn't available. Please ask your service provider for an updated link.</p>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <ReviewThankYou
        companyName={company.name}
        companyLogoUrl={company.logo_url}
        brandColor={brand.primary}
        stars={stars}
        reviewText={feedback}
        redirectUrl={positiveRedirectUrl}
      />
    );
  }

  async function submitRating() {
    const result = await submit({ data: {
      companySlug, stars,
      feedback: feedback.trim() || null,
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      customerEmail: customerEmail.trim() || null,
      reviewToken,
    } });
    return result;
  }

  return <div className="min-h-screen bg-background pb-16">
    <header className="px-6 py-8 text-center text-white" style={{ background: brand.primary }}>
      {company.logo_url ? <img src={company.logo_url} alt={company.name} className="mx-auto h-12" /> : <div className="text-sm uppercase tracking-widest opacity-80">{company.name}</div>}
      <div className="mx-auto mt-5 max-w-sm">
        <p className="text-base font-semibold">Your feedback matters to us</p>
        <p className="mt-1 text-sm leading-snug opacity-90">
          {knownName ? `${firstName(customerName)}, your` : "Your"} review helps {company.name} improve the experience for every customer.
        </p>
      </div>
    </header>

    <form className="mx-auto max-w-md px-5 pt-6" onSubmit={async (e) => {
      e.preventDefault(); setError(null);
      if (!stars) { setError("Please tap a star rating."); return; }
      if (!customerEmail.trim()) { setError("Please provide your email for confirmation and receipt."); return; }
      if (!emailOk) { setError("Please enter a valid email address."); return; }
      if (!tipValid) { setError(`Tip must be between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`); return; }
      if (finalTipCents > 0) { setError("Use the secure payment button above to finish your tip."); return; }
      setBusy(true);
      try {
        const result = await submitRating();
        setPositiveRedirectUrl(result.redirectUrl ?? null);
        setDone(true);
      } catch (err) { setError(err instanceof Error ? err.message : "Could not submit"); } finally { setBusy(false); }
    }}>
      <section className="rounded-xl border border-border bg-card p-5">
        <h1 className="text-base font-semibold">How did your driver do?</h1>
        <div className="mt-3 flex justify-between" onMouseLeave={() => setHoverStars(0)}>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = (hoverStars || stars) >= n;
            return (
              <button type="button" key={n} onMouseEnter={() => setHoverStars(n)} onClick={() => setStars(n)}
                className="p-1 text-4xl leading-none transition-transform active:scale-95"
                style={{ color: active ? brand.secondary : "var(--muted-foreground)" }} aria-label={`${n} stars`}>★</button>
            );
          })}
        </div>

        <label className="mt-5 block text-sm font-medium">Tell us about your experience</label>
        <div className="mt-2 inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          Choose as many as apply
        </div>
        <ReviewQualityPicker
          qualities={REVIEW_QUALITIES}
          selectedIds={selectedQualities}
          onToggle={toggleQuality}
          brandColor={brand.secondary}
        />
        <textarea value={feedback} onChange={(e) => { setFeedback(e.target.value); setReviewCopied(false); }} rows={3} maxLength={2000}
          placeholder="Choose an option above or write your own review"
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        {stars >= 4 && feedback.trim() && company.positive_redirect_url && (
          <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-slate-900">
            <button type="button" onClick={() => void copyFeedbackForReview()}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-200 px-4 py-2.5 text-sm font-bold text-cyan-950 shadow-sm transition-colors hover:bg-cyan-300">
              {reviewCopied ? <Check className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
              {reviewCopied ? "Copied" : "Copy for public review"}
            </button>
            <p className="mt-2 text-xs text-cyan-900">After this step, we’ll open the public review page so you can paste your review there.</p>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {!knownName && <Field label="Your name" value={customerName} setValue={setCustomerName} />}
          {!knownPhone && <Field label="Phone" value={customerPhone} setValue={setCustomerPhone} placeholder="(555) 123-4567" />}
          <div className="sm:col-span-2">
            <Field label="Please provide your email for confirmation and receipt" value={customerEmail} setValue={setCustomerEmail} type="email" placeholder="you@example.com" required />
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-xl border-2 bg-card p-5" style={{ borderColor: SKY, boxShadow: `0 0 0 4px ${SKY}22` }}>
        <h2 className="text-lg font-bold" style={{ color: SKY }}>Leave your driver a tip</h2>
        <p className="mt-1 text-xs text-muted-foreground">Your tip goes to the {company.name} crew who helped you.</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {PRESET_TIPS.map((c) => {
            const selected = tipCents === c;
            return (
              <button type="button" key={c}
                onClick={() => { setTipCents(tipCents === c ? null : c); setCustomTip(""); setCustomTipOpen(false); setError(null); }}
                className="rounded-md border-2 px-2 py-3 text-base font-bold"
                style={selected ? { background: SKY, color: "white", borderColor: SKY } : { borderColor: SKY, color: SKY }}>
                ${(c / 100).toFixed(0)}
              </button>
            );
          })}
          <button type="button"
            onClick={() => { setTipCents(null); setCustomTip(""); setCustomTipOpen((open) => !open); setError(null); }}
            className="rounded-md border-2 px-2 py-3 text-base font-bold"
            style={customTipOpen ? { background: SKY, color: "white", borderColor: SKY } : { borderColor: SKY, color: SKY }}>
            Custom
          </button>
        </div>
        {customTipOpen && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input autoFocus type="number" min={0} step="0.01" inputMode="decimal" value={customTip}
              onChange={(e) => { setCustomTip(e.target.value); setTipCents(null); setError(null); }}
              placeholder="Enter tip amount" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
        )}
        {finalTipCents > 0 && tipValid && emailOk && (
          <StripeCardPanel
            companySlug={companySlug}
            amountCents={finalTipCents}
            customerName={customerName || null}
            customerPhone={customerPhone || null}
            customerEmail={customerEmail || null}
            stars={stars || null}
            brandColor={brand.primary}
            onPaid={async () => {
              if (stars) {
                try {
                  const result = await submitRating();
                  setPositiveRedirectUrl(result.redirectUrl ?? null);
                } catch { /* The payment is still safely recorded by Stripe's webhook. */ }
              }
              setDone(true);
            }}
          />
        )}
      </section>

      {error && <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {finalTipCents === 0 && (
        <button type="submit" disabled={busy}
          className="mt-6 w-full rounded-md border-2 bg-white px-4 py-3 text-base font-bold shadow-sm disabled:opacity-50"
          style={{ borderColor: SKY, color: SKY }}>
          {busy ? "Submitting…" : "Submit Rating"}
        </button>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">Powered by Blue Collar Tips</p>
      <p className="mt-2 flex justify-center gap-3 text-xs text-muted-foreground">
        <a href="/privacy" className="underline">Privacy</a>
        <a href="/terms" className="underline">Terms</a>
      </p>
    </form>
  </div>;
}

function Field({ label, value, setValue, type = "text", placeholder, required }: {
  label: string; value: string; setValue: (value: string) => void; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input type={type} value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} placeholder={placeholder} required={required}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
    </label>
  );
}

async function copyReviewText(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through for browsers that block the async Clipboard API.
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}
