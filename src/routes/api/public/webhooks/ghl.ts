import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { timingSafeEqual } from "crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
} as const;

const Body = z.object({
  companySlug: z.string().min(1),
  driver: z.object({
    // At least one of these must be provided to match a driver.
    slug: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(5).optional(),
  }),
  contact: z
    .object({
      name: z.string().trim().max(200).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().max(40).optional(),
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

function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "").slice(-10);
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
        const { companySlug, driver: driverKey, contact } = parsed.data;

        const { db } = await import("@/db/client.server");

        const { data: company } = await db
          .from("companies")
          .select("id, name, slug")
          .eq("slug", companySlug)
          .maybeSingle();
        if (!company) return json(404, { error: `Company not found: ${companySlug}` });

        let query = db
          .from("drivers")
          .select("id, slug, display_name, email, phone, status")
          .eq("company_id", company.id)
          .eq("status", "active")
          .limit(1);

        if (driverKey.slug) {
          query = query.eq("slug", driverKey.slug);
        } else if (driverKey.email) {
          query = query.ilike("email", driverKey.email);
        } else if (driverKey.phone) {
          const digits = normalizePhone(driverKey.phone);
          query = query.ilike("phone", `%${digits}%`);
        } else {
          return json(400, { error: "driver.slug, driver.email, or driver.phone required" });
        }

        const { data: driver } = await query.maybeSingle();
        if (!driver) return json(404, { error: "No matching active driver for company" });

        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const tipUrl = `${origin}/${company.slug}/d/${driver.slug}`;

        return json(200, {
          ok: true,
          tipUrl,
          shortUrl: tipUrl,
          company: { id: company.id, name: company.name, slug: company.slug },
          driver: { id: driver.id, name: driver.display_name, slug: driver.slug },
          contact: contact ?? null,
        });
      },
    },
  },
});