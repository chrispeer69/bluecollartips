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

/** Opaque, stable filter key for an employee (never exposes the slug, which holds the full name). */
export function driverKey(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "d" + h.toString(36);
}

/** Companies that opted in to the public feed (comma-separated slugs). */
export function publicFeedAllowed(slug: string, env = process.env.PUBLIC_REVIEW_FEED_SLUGS ?? ""): boolean {
  return env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(slug.toLowerCase());
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
};

type Row = {
  id: string; stars: number; created_at: Date | string; feedback: string | null;
  customer_name: string | null; public_ok: boolean; driver_slug: string | null;
  driver_name: string | null; driver_status: string | null;
};

export function toPublicReview(r: Row): PublicReview {
  const activeDriver = r.driver_slug && r.driver_status === "active";
  const text = r.public_ok && r.feedback && r.feedback.trim() ? r.feedback.trim().slice(0, 2000) : null;
  return {
    id: r.id,
    stars: r.stars,
    createdAt: new Date(r.created_at).toISOString(),
    driver: activeDriver ? firstNameLastInitial(r.driver_name) : null,
    driverKey: activeDriver ? driverKey(r.driver_slug as string) : null,
    text,
    customer: r.public_ok ? firstNameLastInitial(r.customer_name) : null,
  };
}
