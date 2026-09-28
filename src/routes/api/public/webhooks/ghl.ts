import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyGhlSecret } from "@/lib/webhook-auth.server";
import { hashReviewToken, newReviewToken } from "@/lib/review-webhooks.server";
import { matchDriver, type DriverCandidate } from "@/lib/driver-match";

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
  // Pickup city and service type from the dispatch system (e.g. TowBook "Tow Source City" / "Reason").
  city: optionalText(z.string().trim().max(120)),
  service: optionalText(z.string().trim().max(120)),
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

function validEmail(value: string | undefined): string | null {
  if (!value) return null;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export const Route = createFileRoute("/api/public/webhooks/ghl")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        if (!verifyGhlSecret(request)) return json(401, { error: "Invalid or missing webhook secret" });

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
          job_city: parsed.data.city ?? null,
          job_service: parsed.data.service ?? null,
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
