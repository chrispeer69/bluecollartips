import { createFileRoute } from "@tanstack/react-router";
import { toPublicCompanyReview } from "@/lib/public-reviews";

// Read-only public review feed for companies that explicitly enable sharing.
// Every rating is included so low ratings are never hidden; comments and names
// only for ratings submitted after the form's public notice (ratings.public_ok).
// The slug is validated and always used as a query parameter.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } as const;
const CACHE_MS = 10 * 60 * 1000;
const COMPANY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const cache = new Map<string, { at: number; body: string }>();

function json(status: number, body: string, extra: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", ...CORS, ...extra } });
}

export const Route = createFileRoute("/api/public/reviews/$companySlug")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params }) => {
        const slug = String(params.companySlug ?? "").toLowerCase();
        if (slug.length > 120 || !COMPANY_SLUG.test(slug)) {
          return json(404, JSON.stringify({ error: "Company not found" }));
        }
        const { sql } = await import("@/db/client.server");
        const [company] = await sql()`
          SELECT id, name, slug
          FROM companies
          WHERE slug = ${slug}
            AND status = 'active'
            AND public_review_feed_enabled = true
        `;
        if (!company) return json(404, JSON.stringify({ error: "Company not found" }));
        const hit = cache.get(slug);
        if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body);
        const rows = await sql()`
          SELECT r.id, r.stars, r.created_at, r.feedback, r.customer_name, r.public_ok
          FROM ratings r
          WHERE r.company_id = ${company.id}
          ORDER BY r.created_at DESC
          LIMIT 5000
        `;
        const body = JSON.stringify({
          company: { name: company.name, slug: company.slug },
          generatedAt: new Date().toISOString(),
          publicTextSince: "2026-09-28",
          reviews: (rows as unknown as Parameters<typeof toPublicCompanyReview>[0][]).map(toPublicCompanyReview),
        });
        cache.set(slug, { at: Date.now(), body });
        return json(200, body);
      },
    },
  },
});
