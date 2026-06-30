import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicDriver, submitRating } from "@/lib/public.functions";
import { PRESET_TIPS, TIP_MAX_CENTS, TIP_MIN_CENTS, dollars } from "@/lib/constants";
import { StripeCardPanel } from "@/components/StripeCardPanel";

export const Route = createFileRoute("/$companySlug/d/$driverSlug")({
  head: () => ({
    meta: [
      { title: "Rate your service" },
      { name: "description", content: "Rate your service and leave an optional tip." },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: TipPage,
});

type TipSource = "stripe" | "venmo" | "cashapp" | "zelle" | "paypal" | "cash" | "other";

function TipPage() {
  const { companySlug, driverSlug } = useParams({ from: "/$companySlug/d/$driverSlug" });
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
  const [tipSource, setTipSource] = useState<TipSource | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDriver({ data: { companySlug, driverSlug } })
      .then(setData)
      .finally(() => setLoading(false));
  }, [companySlug, driverSlug, getDriver]);

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
            This tip link isn't available. Please ask the driver for an updated link.
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
            Your feedback helps {driver.display_name} and the {company.name} team keep raising the
            bar.
          </p>
          {/* Future: Google review redirect button hooks in here */}
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
    if (finalTipCents > 0 && !tipSource) {
      setError("Choose how you'd like to tip.");
      return;
    }
    if (!tipValid) {
      setError(`Tip must be between ${dollars(TIP_MIN_CENTS)} and ${dollars(TIP_MAX_CENTS)}.`);
      return;
    }
    // Stripe card path: rating must be submitted first; webhook records the tip when payment succeeds.
    if (finalTipCents > 0 && tipSource === "stripe") {
      setError("Tap the blue Pay-by-card button above to finish your tip.");
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        data: {
          companySlug,
          driverSlug,
          stars,
          feedback: feedback.trim() || null,
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerEmail: customerEmail.trim() || null,
          tipCents: finalTipCents > 0 ? finalTipCents : null,
          tipSource: finalTipCents > 0 ? tipSource : null,
        },
      });
      // If they chose a P2P deep link, open it now.
      if (finalTipCents > 0 && tipSource && tipSource !== "stripe" && tipSource !== "cash") {
        const url = p2pLink(tipSource, driver, finalTipCents);
        if (url) window.open(url, "_blank");
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
              <label className="block text-sm font-medium">Your name (optional)</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                maxLength={120}
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Phone (for a thank-you text)</label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="(555) 123-4567"
                maxLength={40}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium">Email (for a thank-you email)</label>
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
                    setTipCents(c);
                    setCustomTip("");
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
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Custom $</span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={customTip}
              onChange={(e) => {
                setCustomTip(e.target.value);
                setTipCents(null);
              }}
              placeholder="0.00"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {(tipCents || customTip) && (
              <button
                type="button"
                onClick={() => {
                  setTipCents(null);
                  setCustomTip("");
                  setTipSource(null);
                }}
                className="text-xs text-muted-foreground underline"
              >
                clear
              </button>
            )}
          </div>

          {finalTipCents > 0 && (
            <>
              <label className="mt-5 block text-sm font-medium">Your name (optional)</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                maxLength={120}
              />

              <div className="mt-5 text-sm font-medium">Payment method</div>
              <button
                type="button"
                onClick={() => setTipSource("stripe")}
                className="mt-2 w-full rounded-md px-4 py-3 text-sm font-semibold text-white"
                style={{
                  background: tipSource === "stripe" ? brand.primary : brand.secondary,
                  outline: tipSource === "stripe" ? `2px solid ${brand.primary}` : undefined,
                }}
              >
                Card / Apple Pay / Google Pay
              </button>
              {tipSource === "stripe" && (
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
                        await submit({
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
                          },
                        });
                      } catch { /* rating optional after payment */ }
                    }
                    setDone(true);
                  }}
                />
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ["venmo", "Venmo", driver.venmo_handle],
                    ["cashapp", "Cash App", driver.cashapp_handle],
                    ["zelle", "Zelle", driver.zelle_handle],
                    ["paypal", "PayPal", driver.paypal_handle],
                  ] as const
                )
                  .filter(([, , handle]) => !!handle)
                  .map(([key, label]) => {
                    const selected = tipSource === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setTipSource(key)}
                        className="rounded-md border px-3 py-2 text-sm"
                        style={
                          selected
                            ? { borderColor: brand.primary, background: "var(--muted)" }
                            : { borderColor: "var(--border)" }
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
              </div>
              {tipSource && tipSource !== "stripe" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  You'll be sent to the {tipSource} app to complete the tip. Your driver will
                  manually confirm receipt — the rating is recorded either way.
                </p>
              )}
            </>
          )}
        </section>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-md px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          style={{ background: brand.primary }}
        >
          {submitting ? "Submitting…" : finalTipCents > 0 ? `Submit & tip ${dollars(finalTipCents)}` : "Submit rating"}
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Powered by Blue Collar AI
        </p>
      </form>
    </div>
  );
}

function p2pLink(
  source: TipSource,
  driver: { venmo_handle: string | null; cashapp_handle: string | null; zelle_handle: string | null; paypal_handle: string | null },
  cents: number,
): string | null {
  const amount = (cents / 100).toFixed(2);
  switch (source) {
    case "venmo":
      return driver.venmo_handle
        ? `https://venmo.com/${encodeURIComponent(driver.venmo_handle.replace(/^@/, ""))}?txn=pay&amount=${amount}&note=Tip`
        : null;
    case "cashapp":
      return driver.cashapp_handle
        ? `https://cash.app/${encodeURIComponent(driver.cashapp_handle.startsWith("$") ? driver.cashapp_handle : `$${driver.cashapp_handle}`)}/${amount}`
        : null;
    case "paypal":
      return driver.paypal_handle
        ? `https://paypal.me/${encodeURIComponent(driver.paypal_handle)}/${amount}`
        : null;
    case "zelle":
      return null; // Zelle has no public deep link; handle is shown on confirmation
    default:
      return null;
  }
}