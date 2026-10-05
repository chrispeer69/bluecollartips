import { ArrowUpRight, Camera, Sparkles, X } from "lucide-react";
import type { ReviewLink, ReviewSiteId } from "@/lib/review-sites";
import { ReviewSiteMark } from "@/components/ReviewSiteMark";

export function ReviewThankYou({
  companyName,
  companyLogoUrl,
  brandColor,
  stars,
  driverName,
  reviewLinks = [],
  onSiteClick,
}: {
  companyName: string;
  companyLogoUrl?: string | null;
  brandColor: string;
  stars: number;
  driverName?: string | null;
  reviewLinks?: ReviewLink[];
  /** Records the tap for the VIP follow-up report; never holds up the redirect for long. */
  onSiteClick?: (site: ReviewSiteId) => Promise<unknown> | void;
}) {
  const positive = stars >= 4;

  function closePage() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
  }

  function openSite(link: ReviewLink) {
    if (onSiteClick) void Promise.resolve().then(() => onSiteClick(link.site)).catch(() => undefined);
  }

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

          {reviewLinks.length > 0 ? (
            <div className="p-6">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-50 via-white to-amber-50 px-5 py-6 text-center ring-1 ring-slate-200">
                <Sparkles className="absolute right-5 top-5 h-5 w-5 text-amber-400" aria-hidden="true" />
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-cyan-700 shadow-md ring-1 ring-cyan-100">
                  <Camera className="h-8 w-8" strokeWidth={1.8} aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-950">
                  Help others choose with confidence
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
                  Your feedback helps us improve. A few words and a photo can help future customers know what to expect.
                </p>
              </div>
              <p className="mt-5 text-center text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Choose where to share
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                    {reviewLinks.map((link) => (
                      <a
                        key={link.site}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => openSite(link)}
                        className="group flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-bold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-md"
                      >
                        <ReviewSiteMark site={link.site} className="h-7 w-7" />
                        <span className="min-w-0 flex-1">{link.label}</span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-cyan-700" aria-hidden="true" />
                      </a>
                    ))}
              </div>
            </div>
          ) : null}
        </section>

        <p className="mt-5 text-center text-xs text-slate-500">Powered by Blue Collar Tips</p>
      </div>
    </div>
  );
}
