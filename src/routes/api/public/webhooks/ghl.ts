import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { hashReviewToken, newReviewToken } from "@/lib/review-webhooks.server";

const optionalText = (schema: z.ZodString) => z.preprocess(
  (value) => value === null || value === undefined || value === "" ? undefined : String(value),
  schema.optional(),
) as unknown as z.ZodOptional<z.ZodString>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
} as const;

const Body = z.object({
  companySlug: z.string().min(1),
  jobId: z.preprocess((value) => String(value), z.string().trim().min(1).max(200)),
  ghlContactId: optionalText(z.string().trim().max(200)),
  expiresInDays: z.number().int().min(1).max(30).optional(),
  driver: z.object({
    // At least one of these must be provided to match a driver.
    slug: optionalText(z.string().trim().min(1)),
    name: optionalText(z.string().trim().min(1).max(120)),
    email: optionalText(z.string().trim().email()),
    phone: optionalText(z.string().trim().min(5)),
  }).optional(),
  contact: z
    .object({
      name: optionalText(z.string().trim().max(200)),
      email: optionalText(z.string().trim().max(200)),
      phone: optionalText(z.string().trim().max(40)),
    })
    .optional(),
});

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function verifySecret(request: Request): boolean {
  const expected = process.env.GHL_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function validEmail(value: string | undefined): string | null {
  if (!value) return null;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

type DriverCandidate = { id: string; slug: string; display_name: string; email: string | null; phone: string | null; status: string };
type DriverKey = { slug?: string; name?: string; email?: string; phone?: string };

const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const last10 = (s: string) => s.replace(/[^0-9]/g, "").slice(-10);
const nameTokens = (s: string) => normText(s).split(" ").filter(Boolean);
// When several employees satisfy the same key, prefer an active one.
const preferActive = (matches: DriverCandidate[]) =>
  matches.find((c) => c.status === "active") ?? matches[0] ?? null;

/**
 * Resolve the employee a job belongs to, from whatever identifiers dispatch sent.
 * Keys are tried strongest-first (slug, email, phone, then name), and each key is
 * attempted independently so a bad name still matches on a good phone or email.
 * Ambiguous fuzzy-name hits resolve to null rather than guessing the wrong person.
 */
function matchDriver(candidates: DriverCandidate[], key: DriverKey): DriverCandidate | null {
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

export const Route = createFileRoute("/api/public/webhooks/ghl")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        if (!verifySecret(request)) return json(401, { error: "Invalid or missing webhook secret" });

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON body" });
        }
        const parsed = Body.safeParse(payload);
        if (!parsed.success) return json(400, { error: "Invalid payload", details: parsed.error.flatten() });
        const { companySlug, jobId, ghlContactId, expiresInDays, driver: driverKey, contact } = parsed.data;

        const { db } = await import("@/db/client.server");

        const { data: company } = await db
          .from("companies")
          .select("id, name, slug")
          .eq("slug", companySlug)
          .maybeSingle();
        if (!company) return json(404, { error: `Company not found: ${companySlug}` });

        let driver: DriverCandidate | null = null;
        if (driverKey && (driverKey.slug || driverKey.name || driverKey.email || driverKey.phone)) {
          // Load the company roster once and match in-process so a single job can
          // be attributed by ANY provided key (not just the first), tolerating
          // case, spacing, phone formatting and simple name variations. Only
          // deactivated employees are excluded from matching.
          const { data: roster } = await db.from("drivers")
            .select("id, slug, display_name, email, phone, status")
            .eq("company_id", company.id);
          const candidates = (roster ?? []).filter((c) => c.status !== "deactivated");
          driver = matchDriver(candidates as DriverCandidate[], driverKey);
        }

        const url = new URL(request.url);
        const configuredOrigin = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "");
        const origin = configuredOrigin?.startsWith("https://")
          ? configuredOrigin
          : `https://${url.host}`;
        const token = newReviewToken();
        const expiresAt = new Date(Date.now() + (expiresInDays ?? 10) * 86_400_000).toISOString();
        const { error: contextError } = await db.from("review_contexts").upsert({
          company_id: company.id, driver_id: driver?.id ?? null, token_hash: hashReviewToken(token),
          external_job_id: jobId, external_contact_id: ghlContactId ?? null, expires_at: expiresAt,
          customer_name: contact?.name ?? null,
          customer_phone: contact?.phone ?? null,
          customer_email: validEmail(contact?.email),
          // Remember who dispatch said did the job, matched or not, so an admin
          // can attribute the review later if matching failed.
          dispatch_driver_name:
            driverKey?.name ?? driverKey?.slug ?? driverKey?.email ?? driverKey?.phone ?? null,
        }, { onConflict: "company_id,external_job_id" });
        if (contextError) return json(500, { error: "Could not create review link" });
        const path = driver ? `/${company.slug}/d/${driver.slug}` : `/${company.slug}`;
        const tipUrl = `${origin}${path}?t=${encodeURIComponent(token)}`;

        return json(200, {
          ok: true,
          tipUrl,
          shortUrl: tipUrl,
          company: { id: company.id, name: company.name, slug: company.slug },
          driver: driver ? { id: driver.id, name: driver.display_name, slug: driver.slug } : null,
          matchedDriver: Boolean(driver),
          jobId,
          expiresAt,
          contact: contact ?? null,
        });
      },
    },
  },
});
