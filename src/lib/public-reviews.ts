// Public review feed helpers (no DB, no React) — shared by the feed route and tests.

/** "Mike Rodriguez" -> "Mike R."; "mike" -> "Mike"; never returns a full last name. */
export function firstNameLastInitial(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return null;
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const first = cap(parts[0].replace(/[^\p{L}'-]/gu, "")) || null;
  if (!first) return null;
  const last = parts.length > 1 ? parts[parts.length - 1].replace(/[^\p{L}]/gu, "") : "";
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/**
 * "Tim Wilson" -> "Tim"; "  TIM  " -> "Tim"; "mary ann smith" -> "Mary".
 * First name only — never a last name or last initial. Used for employees on
 * the private (server-to-server) company feed.
 */
export function firstNameOnly(name: string | null | undefined): string | null {
  const word = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const letters = word.replace(/[^\p{L}'-]/gu, "");
  if (!letters || !/\p{L}/u.test(letters)) return null;
  const sane = letters === letters.toUpperCase() && letters.length > 2 ? letters.toLowerCase() : letters;
  return sane.charAt(0).toUpperCase() + sane.slice(1);
}

/** Removes contact details from a public comment: emails, phone numbers and web links. */
export function scrubContact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email removed]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "[link removed]")
    .trim();
}

/** Opaque, stable filter key for an employee (never exposes the slug, which holds the full name). */
export function driverKey(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "d" + h.toString(36);
}

export type PublicReview = {
  id: string;
  stars: number;
  createdAt: string;
  /** Employee first name + last initial (active employees only), or null. */
  driver: string | null;
  /** Opaque stable key for filtering by employee, or null. */
  driverKey: string | null;
  /** Written comment, only when the customer submitted after the public notice. */
  text: string | null;
  /** Customer first name + last initial, same rule as text. */
  customer: string | null;
  /** Tied to a real dispatch job: a review link sent from the job, or matched to it by job number, phone or email. */
  verified: boolean;
  /** Pickup city and service from the dispatch job, when known. */
  city: string | null;
  service: string | null;
};

export type PublicCompanyReview = Pick<PublicReview, "stars" | "createdAt" | "text" | "customer">;

/** Minimal cross-site payload. Never includes employee, job, location, contact, or payment data. */
export function toPublicCompanyReview(r: Row): PublicCompanyReview {
  const review = toPublicReview(r);
  return {
    stars: review.stars,
    createdAt: review.createdAt,
    text: review.text,
    customer: review.customer,
  };
}

export type PrivateCompanyReview = PublicReview;

/**
 * Private company feed (the company's own website, server-to-server with a
 * bearer token): the full public review shape, but the employee is shown by
 * FIRST NAME ONLY. Same public_ok rule for text and customer.
 */
export function toPrivateCompanyReview(r: Row): PrivateCompanyReview {
  const review = toPublicReview(r);
  return { ...review, driver: review.driverKey ? firstNameOnly(r.driver_name) : null };
}

export type ReviewFeedRow = Row;

type Row = {
  id: string; stars: number; created_at: Date | string; feedback: string | null;
  customer_name: string | null; public_ok: boolean; driver_slug: string | null;
  driver_name: string | null; driver_status: string | null;
  review_context_id?: string | null; dispatch_match?: string | null;
  job_city?: string | null; job_service?: string | null;
};

const tidy = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.split(" ").map((w) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(" ");
};

export function toPublicReview(r: Row): PublicReview {
  const activeDriver = r.driver_slug && r.driver_status === "active";
  const text = r.public_ok && r.feedback && r.feedback.trim() ? scrubContact(r.feedback).slice(0, 2000) || null : null;
  return {
    id: r.id,
    stars: r.stars,
    createdAt: new Date(r.created_at).toISOString(),
    driver: activeDriver ? firstNameLastInitial(r.driver_name) : null,
    driverKey: activeDriver ? driverKey(r.driver_slug as string) : null,
    text,
    customer: r.public_ok ? firstNameLastInitial(r.customer_name) : null,
    verified: Boolean(r.review_context_id) || r.dispatch_match === "job" || r.dispatch_match === "phone" || r.dispatch_match === "email",
    city: tidy(r.job_city),
    service: tidy(r.job_service),
  };
}
