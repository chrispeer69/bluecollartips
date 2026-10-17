// Shared bits for page <head> tags: canonical URLs and link-preview images.
export const SITE_URL = "https://bluecollartips.app";
export const SITE_NAME = "Blue Collar Tips & Reviews";
/** 1200×630 banner used when a page has no picture of its own. */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Absolute https image for og:image, or the default banner. */
export function pageImage(url?: string | null) {
  if (!url) return DEFAULT_OG_IMAGE;
  if (url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${SITE_URL}${url}`;
  return DEFAULT_OG_IMAGE;
}

/** Article + BreadcrumbList structured data for a guide page. */
export function guideJsonLd(guide: { path: string; headline: string; description: string; published: string; modified: string }) {
  const url = `${SITE_URL}${guide.path}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: guide.headline,
        description: guide.description,
        image: [DEFAULT_OG_IMAGE],
        datePublished: guide.published,
        dateModified: guide.modified,
        author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        publisher: ORGANIZATION,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        inLanguage: "en-US",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: guide.headline, item: url },
        ],
      },
    ],
  });
}

/** Who publishes the site, for structured data. */
export const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  legalName: "Blue Collar AI, Inc.",
  url: SITE_URL,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 },
};
