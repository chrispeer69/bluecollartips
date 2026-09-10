import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicDriver, submitRating } from "@/lib/public.functions";
import { PRESET_TIPS, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";
import { StripeCardPanel } from "@/components/StripeCardPanel";

export const Route = createFileRoute("/$companySlug/d/$driverSlug")({
  validateSearch: (search: Record<string, unknown>) => ({ t: typeof search.t === "string" ? search.t : undefined }),
  head: ({ params }) => ({
    meta: [
      { title: "Rate your service — Blue Collar Tips" },
      { name: "description", content: "Rate your service, leave feedback, and tip your service pro securely by card or P2P — powered by Blue Collar Tips." },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { property: "og:title", content: "Rate your service — Blue Collar Tips" },
      { property: "og:description", content: "Rate your service, leave feedback, and tip securely by card or P2P." },
      { property: "og:url", content: `https://bluecollartips.app/${params.companySlug}/d/${params.driverSlug}` },
    ],
    links: [{ rel: "canonical", href: `https://bluecollartips.app/${params.companySlug}/d/${params.driverSlug}` }],
  }),
  component: TipPage,
});

function TipPage() {
  const { companySlug, driverSlug } = useParams({ from: "/$companySlug/d/$driverSlug" });
  const { t: reviewToken } = Route.useSearch();
  const getDriver = useServerFn(getPublicDriver);
  const submit = useServerFn(submitRating);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof getPublicDriver>> | null>(null);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [tipCents, setTipCents] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDriver({ data: { companySlug, driverSlug, reviewToken } })
      .then((result) => {
        setData(result);
        if (result.reviewContact) {
          setCustomerName(result.reviewContact.name ?? "");
          setCustomerPhone(result.reviewContact.phone ?? "");
          const email = result.reviewContact.email ?? "";
          setCustomerEmail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "");
        }
      })
      .finally(() => setLoading(false));
  }, [companySlug, driverSlug, getDriver, reviewToken]);

  const brand = useMemo(() => {
    const primary = data?.company?.primary_color || "#0b2545";
    const secondary = data?.company?.secondary_color || "#f59e0b";
    return { primary, secondary };
  }, [data]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Loading…</div>;
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

  if (done) {
    return (
      <div
        className="min-h-screen px-6 py-10 text-center"
        style={{ background: brand.primary, color: "white" }}
      >
        <div className="mx-auto max-w-md">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.name} className="mx-auto h-16" />
          ) : (
            <div className="text-sm uppercase tracking-widest opacity-80">{company.name}</div>
          )}
          <h1 className="display mt-10 text-3xl font-bold">Thank you!</h1>
          <p className="mt-3 text-base opacity-90">
            Your support helps {driver.display_name} and the {company.name} team keep raising the
            bar.
          </p>
          {stars >= company.positive_rating_threshold && (company.google_review_url || company.yelp_review_url || company.facebook_review_url) && (
            <div className="mt-8 rounded-lg bg-white/10 p-4 text-left">
              <div className="text-center text-sm opacity-90">
                Loved us? Share a review — it takes 30 seconds and means the world:
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {company.google_review_url && (
                  <a
                    href={company.google_review_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold"
                    style={{ color: brand.primary }}
                  >
                    Review on Google
                  </a>
                )}
                {company.yelp_review_url && (
                  <a
                    href={company.yelp_review_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold"
                    style={{ color: brand.primary }}
                  >
                    Review on Yelp
                  </a>
                )}
                {company.facebook_review_url && (
                  <a
                    href={company.facebook_review_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold"
                    style={{ color: brand.primary }}
                  >
                    Review on Facebook
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
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
    if (customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!tipValid) {
      setError(`Tip must be between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`);
      return;
    }
    if (finalTipCents > 0) {
      setError("Use the secure payment button above to finish your tip.");
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
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerEmail: customerEmail.trim() || null,
          tipCents: null,
          tipSource: null,
          reviewToken,
        },
      });
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
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
          {driver.photo_url && (
            <img
              src={driver.photo_url}
              alt={driver.display_name}
              className="h-12 w-12 rounded-full object-cover ring-2 ring-white/40"
            />
          )}
          <div className="text-left">
            <div className="text-xs uppercase tracking-wider opacity-80">Your driver</div>
            <div className="text-lg font-semibold">{driver.display_name}</div>
          </div>
        </div>
      </header>

      <form onSubmit={onSubmit} className="mx-auto max-w-md px-5 pt-6">
        <h1 className="sr-only">Rate your service{driver ? ` with ${driver.display_name}` : ""}</h1>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">How did we do?</h2>
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

          <label className="mt-5 block text-sm font-medium">Anything you'd like to share?</label>
          <textarea
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
            placeholder="Optional"
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Your name</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                maxLength={120}
              />
            </div>
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
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium">Email</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="you@example.com"
                maxLength={200}
              />
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Leave a tip (optional)</h2>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {PRESET_TIPS.map((c) => {
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
                  className="rounded-md border px-2 py-3 text-sm font-medium"
                  style={
                    selected
                      ? { background: brand.secondary, color: "white", borderColor: brand.secondary }
                      : { borderColor: "var(--border)" }
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
              className="rounded-md border px-2 py-3 text-sm font-medium"
              style={
                customTipOpen
                  ? { background: brand.secondary, color: "white", borderColor: brand.secondary }
                  : { borderColor: "var(--border)" }
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
                  brandColor={brand.primary}
                  onPaid={async () => {
                    if (stars) {
                      try {
                        const result = await submit({
                          data: {
                            companySlug,
                            driverSlug,
                            stars,
                            feedback: feedback.trim() || null,
                            customerName: customerName.trim() || null,
                            customerPhone: customerPhone.trim() || null,
                            customerEmail: customerEmail.trim() || null,
                            tipCents: null,
                            tipSource: null,
                            reviewToken,
                          },
                        });
                        if (result.redirectUrl) {
                          window.location.assign(result.redirectUrl);
                          return;
                        }
                      } catch { /* rating optional after payment */ }
                    }
                    setDone(true);
                  }}
                />
              )}
            </>
          )}
        </section>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {finalTipCents === 0 && (
          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-md px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
            style={{ background: brand.primary }}
          >
            {submitting ? "Submitting…" : "Submit rating"}
          </button>
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
