// Shared "which employee is this?" logic, used by the dispatch webhook and by
// the dispatch-export import so both attribute jobs the same way.

export type DriverCandidate = {
  id: string;
  slug: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  status: string;
};
export type DriverKey = { slug?: string; name?: string; email?: string; phone?: string };

export const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export const last10 = (s: string) => s.replace(/[^0-9]/g, "").slice(-10);
export const nameTokens = (s: string) => normText(s).split(" ").filter(Boolean);
// When several employees satisfy the same key, prefer an active one.
const preferActive = (matches: DriverCandidate[]) =>
  matches.find((c) => c.status === "active") ?? matches[0] ?? null;

/**
 * Resolve the employee a job belongs to, from whatever identifiers dispatch sent.
 * Keys are tried strongest-first (slug, email, phone, then name), and each key is
 * attempted independently so a bad name still matches on a good phone or email.
 * Ambiguous fuzzy-name hits resolve to null rather than guessing the wrong person.
 */
export function matchDriver(candidates: DriverCandidate[], key: DriverKey): DriverCandidate | null {
  if (key.slug) {
    const s = normText(key.slug);
    const m = candidates.filter((c) => normText(c.slug) === s);
    if (m.length) return preferActive(m);
  }
  if (key.email) {
    const e = normText(key.email);
    const m = candidates.filter((c) => c.email && normText(c.email) === e);
    if (m.length) return preferActive(m);
  }
  if (key.phone) {
    const p = last10(key.phone);
    if (p.length >= 7) {
      const m = candidates.filter((c) => c.phone && last10(c.phone) === p);
      if (m.length) return preferActive(m);
    }
  }
  if (key.name) {
    const target = normText(key.name);
    const exact = candidates.filter((c) => normText(c.display_name) === target);
    if (exact.length) return preferActive(exact);
    // Fall back to first+last token match (handles middle names/initials),
    // but only commit when it points at a single person.
    const t = nameTokens(key.name);
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      const fuzzy = candidates.filter((c) => {
        const ct = nameTokens(c.display_name);
        return ct.length >= 2 && ct[0] === first && ct[ct.length - 1] === last;
      });
      if (fuzzy.length === 1) return fuzzy[0];
      const actives = fuzzy.filter((c) => c.status === "active");
      if (actives.length === 1) return actives[0];
    }
  }
  return null;
}
