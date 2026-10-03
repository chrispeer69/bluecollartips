// Public review sites a company can send customers to after a rating.

export const REVIEW_SITES = [
  { id: "google", label: "Google", column: "google_review_url" },
  { id: "facebook", label: "Facebook", column: "facebook_review_url" },
  { id: "yelp", label: "Yelp", column: "yelp_review_url" },
  { id: "apple_maps", label: "Apple Maps", column: "apple_maps_review_url" },
  { id: "bing", label: "Bing", column: "bing_review_url" },
  { id: "usta", label: "US Tow Alliance", column: "usta_review_url" },
] as const;

export type ReviewSiteId = (typeof REVIEW_SITES)[number]["id"];
export type ReviewSiteColumn = (typeof REVIEW_SITES)[number]["column"];
export type ReviewLink = { site: ReviewSiteId; label: string; url: string };

export const REVIEW_SITE_IDS = REVIEW_SITES.map((s) => s.id) as [ReviewSiteId, ...ReviewSiteId[]];

/** Review buttons to show a customer: every configured site except the main
 *  redirect, only when the rating meets the company's threshold. */
export function reviewLinksFor(
  company: Partial<Record<ReviewSiteColumn, string | null>> & { positive_rating_threshold?: number | null },
  stars: number,
  mainUrl: string | null | undefined,
): ReviewLink[] {
  if (stars < (company.positive_rating_threshold ?? 4)) return [];
  const links: ReviewLink[] = [];
  for (const s of REVIEW_SITES) {
    const url = company[s.column]?.trim();
    if (url && url !== mainUrl) links.push({ site: s.id, label: s.label, url });
  }
  return links;
}

/** Props for the thank-you page: which site the main button opens and the extra buttons. */
export function reviewSiteProps(
  company: Partial<Record<ReviewSiteColumn, string | null>> & { positive_rating_threshold?: number | null },
  stars: number,
  mainUrl: string | null | undefined,
) {
  const main = mainUrl ? REVIEW_SITES.find((s) => company[s.column]?.trim() === mainUrl) : undefined;
  return {
    mainSite: main?.id ?? null,
    mainSiteLabel: main?.label ?? null,
    otherLinks: reviewLinksFor(company, stars, mainUrl),
  };
}

export function reviewSiteLabel(site: string) {
  return REVIEW_SITES.find((s) => s.id === site)?.label ?? site;
}
