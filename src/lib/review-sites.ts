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

type ReviewSiteCompany = Partial<Record<ReviewSiteColumn, string | null>> & {
  enabled_review_sites?: ReviewSiteId[] | null;
  positive_rating_threshold?: number | null;
};

/** Every configured, enabled destination once the submitted rating meets the threshold. */
export function reviewLinksFor(company: ReviewSiteCompany, stars: number): ReviewLink[] {
  if (stars < (company.positive_rating_threshold ?? 4)) return [];
  const enabledSites = new Set(company.enabled_review_sites ?? REVIEW_SITE_IDS);
  const links: ReviewLink[] = [];
  for (const s of REVIEW_SITES) {
    const url = company[s.column]?.trim();
    if (enabledSites.has(s.id) && url) {
      links.push({ site: s.id, label: s.label, url });
    }
  }
  return links;
}

export function reviewSiteLabel(site: string) {
  return REVIEW_SITES.find((s) => s.id === site)?.label ?? site;
}
