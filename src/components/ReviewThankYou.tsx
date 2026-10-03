import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import type { ReviewLink, ReviewSiteId } from "@/lib/review-sites";

export function ReviewThankYou({
  companyName,
  companyLogoUrl,
  brandColor,
  stars,
  reviewText,
  redirectUrl,
  driverName,
  mainSite,
  mainSiteLabel,
  otherLinks = [],
  onSiteClick,
}: {
  companyName: string;
  companyLogoUrl?: string | null;
  brandColor: string;
  stars: number;
  reviewText: string;
  redirectUrl?: string | null;
  driverName?: string | null;
  /** Which review site the main button opens (null for a custom URL). */
  mainSite?: ReviewSiteId | null;
  mainSiteLabel?: string | null;
  /** Extra review sites shown under the main button. */
  otherLinks?: ReviewLink[];
  /** Records the tap for the VIP follow-up report; never holds up the redirect for long. */
  onSiteClick?: (site: ReviewSiteId) => Promise<unknown> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const positive = stars >= 4;
  const review = reviewText.trim();

  function closePage() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
  }

  async function copyReview() {
    const success = await copyText(review);
    setCopied(success);
    setCopyError(!success);
    return success;
  }

  async function copyAndContinue() {
    const success = review ? await copyReview() : true;
    if (!success || !redirectUrl) return;
    if (onSiteClick && mainSite) {
      await Promise.race([
        Promise.resolve().then(() => onSiteClick(mainSite)).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    }
    window.location.assign(redirectUrl);
  }

  async function openOther(link: ReviewLink) {
    if (review) await copyReview();
    if (onSiteClick) void Promise.resolve().then(() => onSiteClick(link.site)).catch(() => undefined);
  }

  const mainLabel = mainSiteLabel ?? "the review page";
  const hasLinks = Boolean(redirectUrl) || otherLinks.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-6 text-slate-950">
      <div className="mx-auto max-w-md">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={closePage}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <section className="mt-3 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-8 text-center text-white" style={{ background: brandColor }}>
            {companyLogoUrl ? (
              <img src={companyLogoUrl} alt={companyName} className="mx-auto max-h-14 max-w-56" />
            ) : (
              <div className="text-sm font-semibold uppercase tracking-[0.2em] opacity-90">
                {companyName}
              </div>
            )}
            <h1 className="mt-6 text-3xl font-bold">
              {positive ? "Thank you!" : "Thank you for your feedback"}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/90">
              {positive
                ? driverName
                  ? `Your feedback recognizes ${driverName} and helps other customers choose with confidence.`
                  : "Your feedback helps other customers choose with confidence."
                : `We’re always striving to improve, and your feedback helps ${companyName} serve customers better.`}
            </p>
          </div>

          {(positive && review) || hasLinks ? (
            <div className="p-6">
              {review ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-bold">Your review</h2>
                    <span className="text-sm font-semibold text-amber-500" aria-label={`${stars} stars`}>
                      {"★".repeat(stars)}
                    </span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{review}</p>
                  </div>
                  {!hasLinks ? (
                    <button
                      type="button"
                      onClick={() => void copyReview()}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-100 px-4 py-3 text-sm font-bold text-cyan-950 transition hover:bg-cyan-200"
                    >
                      {copied ? <Check className="h-5 w-5" aria-hidden="true" /> : <Copy className="h-5 w-5" aria-hidden="true" />}
                      {copied ? "Review copied" : "Copy review"}
                    </button>
                  ) : null}
                  {copyError ? (
                    <p className="mt-2 text-center text-xs text-red-600">
                      Press and hold the review above to copy it.
                    </p>
                  ) : null}
                </>
              ) : null}

              {redirectUrl ? (
                <>
                  <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
                    Paste your review on {mainLabel} and include a photo if you can. It helps other customers choose with confidence.
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyAndContinue()}
                    className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 shadow-sm transition hover:bg-slate-50"
                  >
                    {mainSite === "google" ? <GoogleMark /> : <ExternalLink className="h-5 w-5" aria-hidden="true" />}
                    {review ? `Copy review and continue to ${mainLabel}` : `Continue to ${mainLabel}`}
                  </button>
                </>
              ) : null}

              {otherLinks.length > 0 ? (
                <div className="mt-5">
                  <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {redirectUrl ? "Or leave a review on" : "Leave a review on"}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {otherLinks.map((link) => (
                      <a
                        key={link.site}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => void openOther(link)}
                        className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
                      >
                        {link.site === "google" ? <GoogleMark /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
                        {link.label}
                      </a>
                    ))}
                  </div>
                  {review ? (
                    <p className="mt-2 text-center text-xs text-slate-500">Your review is copied when you tap — just paste it.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <p className="mt-5 text-center text-xs text-slate-500">Powered by Blue Collar Tips</p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.37l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.54l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through for browsers that block the async Clipboard API.
    }
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}
