import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicDriver, submitRating } from "@/lib/public.functions";
import { trackReviewSiteClick } from "@/lib/vip.functions";
import { reviewLinksFor } from "@/lib/review-sites";
import {
  CUSTOMER_TIP_PRESETS,
  DEFAULT_CUSTOMER_TIP_CENTS,
  TIP_MAX_CENTS,
  TIP_MIN_CENTS,
  dollars,
} from "@/lib/constants";
import { StripeCardPanel } from "@/components/StripeCardPanel";
import { ReviewQualityPicker } from "@/components/ReviewQualityPicker";
import { ReviewThankYou } from "@/components/ReviewThankYou";
import { REVIEW_QUALITIES } from "@/lib/review-suggestions";

export const Route = createFileRoute("/$companySlug/d/$driverSlug")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === "string" ? search.t : undefined,
    tip: search.tip === "1" ? "1" as const : undefined,
    r: typeof search.r === "string" ? search.r : undefined,
  }),
  head: ({ params }) => ({
    meta: [
      { title: "Rate your service — Blue Collar Tips" },
      { name: "description", content: "Rate your service, leave feedback, and tip your service pro securely through Stripe — powered by Blue Collar Tips." },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { property: "og:title", content: "Rate your service — Blue Collar Tips" },
      { property: "og:description", content: "Rate your service, leave feedback, and tip securely through Stripe." },
      { property: "og:url", content: `https://bluecollartips.app/${params.companySlug}/d/${params.driverSlug}` },
    ],
    links: [{ rel: "canonical", href: `https://bluecollartips.app/${params.companySlug}/d/${params.driverSlug}` }],
  }),
  component: TipPage,
});

function TipPage() {
  const { companySlug, driverSlug } = useParams({ from: "/$companySlug/d/$driverSlug" });
  const { t: reviewToken, tip: tipMode, r: submittedRatingId } = Route.useSearch();
  const getDriver = useServerFn(getPublicDriver);
  const submit = useServerFn(submitRating);
  const trackSite = useServerFn(trackReviewSiteClick);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof getPublicDriver>> | null>(null);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [selectedQualities, setSelectedQualities] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  // Name/phone already known from the tracked review link — don't ask again.
  const [knownName, setKnownName] = useState(false);
  const [knownPhone, setKnownPhone] = useState(false);
  const [step, setStep] = useState<"review" | "tip">("review");
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // A used/expired job link no longer blocks the page; the customer can still
  // leave a review, just not tied to that job.
  const [reviewAnyway, setReviewAnyway] = useState(false);

  useEffect(() => {
    getDriver({
      data: {
        companySlug,
        driverSlug,
        reviewToken,
        submittedRatingId: tipMode === "1" ? submittedRatingId : null,
      },
    })
      .then((result) => {
        setData(result);
        if (result.reviewContact) {
          const name = (result.reviewContact.name ?? "").trim();
          const phone = (result.reviewContact.phone ?? "").trim();
          setCustomerName(name);
          setCustomerPhone(phone);
          setKnownName(!!name);
          setKnownPhone(!!phone);
          const email = result.reviewContact.email ?? "";
          setCustomerEmail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "");
        }
        if (tipMode === "1" && result.submittedReview) {
          setStars(result.submittedReview.stars);
          setFeedback(result.submittedReview.feedback ?? "");
          setCustomerName(result.submittedReview.customer_name ?? result.reviewContact?.name ?? "");
          setCustomerPhone(result.submittedReview.customer_phone ?? result.reviewContact?.phone ?? "");
          setCustomerEmail(result.submittedReview.customer_email ?? result.reviewContact?.email ?? "");
          setRatingId(result.submittedReview.id);
          setTipCents(DEFAULT_CUSTOMER_TIP_CENTS);
          setStep("tip");
          setDone(result.tipAlreadyReceived);
        }
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [companySlug, driverSlug, getDriver, reviewToken, submittedRatingId, tipMode]);

  const linkIssue = data?.linkIssue ?? null;
  // Only send the job link when it is still good.
  const usableToken = linkIssue ? null : reviewToken;

  const brand = useMemo(() => {
    const primary = data?.company?.primary_color || "#0b2545";
    const secondary = data?.company?.secondary_color || "#f59e0b";
    return { primary, secondary };
  }, [data]);
  function toggleQuality(id: string) {
    setSelectedQualities((current) => current.includes(id)
      ? current.filter((qualityId) => qualityId !== id)
      : [...current, id]);
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Loading…</div>;
  }
  if (loadFailed) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">This page didn't load</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please check your connection and try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Try again</button>
        </div>
      </div>
    );
  }
  if (!data?.company || !data.driver) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Link not active</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This tip link isn't available. Please ask your service provider for an updated link.
          </p>
        </div>
      </div>
    );
  }

  const { company, driver } = data;

  if (linkIssue === "used" && !reviewAnyway && !done) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div className="max-w-sm">
          {company.logo_url && <img src={company.logo_url} alt={company.name} className="mx-auto mb-4 h-12" />}
          <h1 className="text-2xl font-semibold">Thanks, we already have your feedback</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Feedback for this job was already received for {firstName(driver.display_name)}. We appreciate you choosing {company.name}.
          </p>
          <button type="button" onClick={() => setReviewAnyway(true)} className="mt-5 rounded-md border border-border px-4 py-2 text-sm font-semibold">
            Leave another review
          </button>
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
        driverName={driver.display_name}
        reviewLinks={reviewLinksFor(company, stars)}
        onSiteClick={ratingId ? (site) => trackSite({ data: { ratingId, site } }) : undefined}
      />
    );
  }

  const finalTipCents = (() => {
    if (tipCents != null) return tipCents;
    const v = Math.round(parseFloat(customTip || "0") * 100);
    return Number.isFinite(v) && v > 0 ? v : 0;
  })();
  const tipValid =
    finalTipCents === 0 ||
    (finalTipCents >= TIP_MIN_CENTS && finalTipCents <= TIP_MAX_CENTS);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!stars) {
      setError("Please tap a star rating.");
      return;
    }
    if (!customerEmail.trim()) {
      setError("Please provide your email for confirmation and receipt.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await submit({
        data: {
          companySlug,
          driverSlug,
          stars,
          feedback: feedback.trim() || null,
          qualityBadges: selectedQualities,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerEmail: customerEmail.trim() || null,
          reviewToken: usableToken,
        },
      });
      setRatingId(result.ratingId);
      if (stars >= 4) {
        setTipCents(DEFAULT_CUSTOMER_TIP_CENTS);
        setStep("tip");
      } else {
        setDone(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  function finishTipStep() {
    setDone(true);
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <header
        className="px-6 py-8 text-center text-white"
        style={{ background: brand.primary }}
      >
        {company.logo_url ? (
          <img src={company.logo_url} alt={company.name} className="mx-auto h-12" />
        ) : (
          <div className="text-sm uppercase tracking-widest opacity-80">{company.name}</div>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <DriverAvatar
            photoUrl={driver.photo_url}
            name={driver.display_name}
            className="h-12 w-12 ring-2 ring-white/40"
          />
          <div className="text-left">
            <div className="text-xs uppercase tracking-wider opacity-80">Your driver</div>
            <div className="text-lg font-semibold">{driver.display_name}</div>
          </div>
        </div>
        <div className="mx-auto mt-5 max-w-sm">
          <p className="text-base font-semibold">Your feedback matters to us</p>
          <p className="mt-1 text-sm leading-snug opacity-90">
            {knownName ? `${firstName(customerName)}, your` : "Your"} review helps {company.name}
            improve the experience for every customer.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="mx-auto max-w-md px-5 pt-6">
        {(linkIssue === "expired" || linkIssue === "other_employee" || linkIssue === "invalid") && (
          <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {linkIssue === "other_employee"
              ? "This feedback link was for a different driver. You can still review "
              : "This feedback link has expired, but you can still review "}
            {firstName(driver.display_name)} here.
          </p>
        )}
        <h1 className="sr-only">Rate your service{driver ? ` with ${driver.display_name}` : ""}</h1>
        {step === "review" && <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">How was your service with {firstName(driver.display_name)}?</h2>
          <div
            className="mt-3 flex justify-between"
            onMouseLeave={() => setHoverStars(0)}
          >
            {[1, 2, 3, 4, 5].map((n) => {
              const active = (hoverStars || stars) >= n;
              return (
                <button
                  type="button"
                  key={n}
                  onMouseEnter={() => setHoverStars(n)}
                  onClick={() => setStars(n)}
                  className="p-1 text-4xl leading-none transition-transform active:scale-95"
                  style={{ color: active ? brand.secondary : "var(--muted-foreground)" }}
                  aria-label={`${n} stars`}
                >
                  ★
                </button>
              );
            })}
          </div>

          <label className="mt-5 block text-sm font-medium">Tell us about your experience</label>
          {company.review_badges_enabled !== false && (
            <>
              <div className="mt-2 inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                Choose as many as apply
              </div>
              <ReviewQualityPicker
                qualities={REVIEW_QUALITIES}
                selectedIds={selectedQualities}
                onToggle={toggleQuality}
                brandColor={brand.secondary}
              />
            </>
          )}
          <textarea
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
            placeholder="Write your own review (optional)"
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {!knownName && (
              <div>
                <label className="block text-sm font-medium">Your name</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  maxLength={120}
                />
              </div>
            )}
            {!knownPhone && (
              <div>
                <label className="block text-sm font-medium">Phone</label>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="(555) 123-4567"
                  maxLength={40}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium">
                Please provide your email for confirmation and receipt
              </label>
              <input
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="you@example.com"
                maxLength={200}
              />
            </div>
          </div>
        </section>}

        {step === "tip" && <section
          className="mt-5 rounded-xl border-2 bg-card p-5"
          style={{ borderColor: SKY, boxShadow: `0 0 0 4px ${SKY}22` }}
        >
          <div className="text-center">
            <h2 className="text-xl font-bold" style={{ color: SKY }}>{firstName(driver.display_name)} would love your support</h2>
            <p className="mt-1 text-sm text-muted-foreground">A tip is optional and goes directly to {firstName(driver.display_name)}.</p>
          </div>
          <div className="mt-5 flex items-center gap-4 rounded-xl bg-muted/40 p-4">
            <DriverAvatar
              photoUrl={driver.photo_url}
              name={driver.display_name}
              className="h-24 w-24 border-2 shadow-sm"
              style={{ borderColor: SKY }}
            />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Your driver</div>
              <div className="text-xl font-bold" style={{ color: SKY }}>{driver.display_name}</div>
              <div className="mt-1 text-sm text-muted-foreground">Leave an optional tip directly for {firstName(driver.display_name)}.</div>
            </div>
          </div>
          {feedback.trim() ? (
            <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-slate-900">
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-900">Your feedback</div>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{feedback.trim()}</p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm">
              Thanks for giving {firstName(driver.display_name)} {stars} stars.
            </div>
          )}
          <h2 className="mt-4 text-lg font-bold" style={{ color: SKY }}>Choose a tip amount</h2>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {CUSTOMER_TIP_PRESETS.map((c) => {
              const selected = tipCents === c;
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => {
                    setTipCents(tipCents === c ? null : c);
                    setCustomTip("");
                    setCustomTipOpen(false);
                    setError(null);
                  }}
                  className="rounded-md border-2 px-2 py-3 text-base font-bold"
                  style={
                    selected
                      ? { background: SKY, color: "white", borderColor: SKY }
                      : { borderColor: SKY, color: SKY }
                  }
                >
                  ${(c / 100).toFixed(0)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setTipCents(null);
                setCustomTip("");
                setCustomTipOpen((open) => !open);
                setError(null);
              }}
              className="rounded-md border-2 px-2 py-3 text-base font-bold"
              style={
                customTipOpen
                  ? { background: SKY, color: "white", borderColor: SKY }
                  : { borderColor: SKY, color: SKY }
              }
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
                onChange={(e) => {
                  setCustomTip(e.target.value);
                  setTipCents(null);
                  setError(null);
                }}
                placeholder="Enter tip amount"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          )}

          {finalTipCents > 0 && (
            <>
              {tipValid && (!customerEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) && (
                <StripeCardPanel
                  companySlug={companySlug}
                  driverSlug={driverSlug}
                  amountCents={finalTipCents}
                  customerName={customerName || null}
                  customerPhone={customerPhone || null}
                  customerEmail={customerEmail || null}
                  stars={stars || null}
                  ratingId={ratingId}
                  brandColor={brand.primary}
                  onPaid={finishTipStep}
                />
              )}
            </>
          )}
          <button
            type="button"
            onClick={finishTipStep}
            className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Continue without a tip
          </button>
        </section>}

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === "review" && (
          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-md border-2 bg-white px-4 py-3 text-base font-bold shadow-sm disabled:opacity-50"
            // White with sky text/border so it reads on any brand color (some
            // tenants' primary is itself a blue that swallows sky text).
            style={{ borderColor: SKY, color: SKY }}
          >
            {submitting ? "Saving…" : "Save review and continue"}
          </button>
        )}
        {step === "review" && (
          <p className="mt-4 text-center text-xs text-muted-foreground">Your star rating and comment may be shown on this company's website with your first name and last initial only. Your phone number and email are never shown.</p>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Powered by Blue Collar Tips
        </p>
        <p className="mt-2 flex justify-center gap-3 text-xs text-muted-foreground">
          <a href="/privacy" className="underline">
            Privacy
          </a>
          <a href="/terms" className="underline">
            Terms
          </a>
        </p>
      </form>
    </div>
  );
}

// Sky blue used to draw attention to the tip box and submit button.
const SKY = "#0ea5e9";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "";
}

function DriverAvatar({
  photoUrl,
  name,
  className = "",
  style,
}: {
  photoUrl?: string | null;
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  if (photoUrl && !imageFailed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setImageFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={style}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${name} profile photo placeholder`}
      className={`grid shrink-0 place-items-center rounded-full bg-slate-200 text-slate-500 ${className}`}
      style={style}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3/5 w-3/5 fill-current">
        <path d="M12 12a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm0 2c-4.14 0-7.5 2.46-7.5 5.5 0 .55.45 1 1 1h13c.55 0 1-.45 1-1 0-3.04-3.36-5.5-7.5-5.5Z" />
      </svg>
    </div>
  );
}
