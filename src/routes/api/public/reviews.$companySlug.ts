import { createFileRoute } from "@tanstack/react-router";
import { publicFeedAllowed, toPublicReview, firstNameLastInitial, driverKey } from "@/lib/public-reviews";

// Read-only public review feed for a company's own website (opt-in per company
// via PUBLIC_REVIEW_FEED_SLUGS). Every rating is included so low ratings are
// never hidden; comments and names only for ratings submitted after the rating
// form's public notice (ratings.public_ok). Names are first name + last initial.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } as const;
const CACHE_MS = 10 * 60 * 1000;
const APP_ORIGIN = () => (process.env.APP_PUBLIC_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
const absolutePhoto = (u: string | null) => (!u ? null : /^https?:\/\//.test(u) ? u : `${APP_ORIGIN()}${u.startsWith("/") ? "" : "/"}${u}`);
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
        if (!publicFeedAllowed(slug)) return json(404, JSON.stringify({ error: "No public review feed for this company" }));
        const hit = cache.get(slug);
        if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body);

        const { sql } = await import("@/db/client.server");
        const [company] = await sql()`SELECT id, name, slug FROM companies WHERE slug = ${slug} AND status = 'active'`;
        if (!company) return json(404, JSON.stringify({ error: "Company not found" }));
        const [rows, drivers] = await Promise.all([
          sql()`
            SELECT r.id, r.stars, r.created_at, r.feedback, r.customer_name, r.public_ok,
                   r.review_context_id, r.dispatch_match,
                   COALESCE(r.job_city, rc.job_city) AS job_city, COALESCE(r.job_service, rc.job_service) AS job_service,
                   d.slug AS driver_slug, d.display_name AS driver_name, d.status AS driver_status
            FROM ratings r LEFT JOIN drivers d ON d.id = r.driver_id
            LEFT JOIN review_contexts rc ON rc.id = r.review_context_id
            WHERE r.company_id = ${company.id}
            ORDER BY r.created_at DESC
            LIMIT 5000`,
          sql()`SELECT slug, display_name, photo_url FROM drivers WHERE company_id = ${company.id} AND status = 'active' ORDER BY display_name`,
        ]);
        const body = JSON.stringify({
          company: { name: company.name, slug: company.slug },
          generatedAt: new Date().toISOString(),
          publicTextSince: "2026-09-28",
          drivers: (drivers as unknown as Array<{ slug: string; display_name: string; photo_url: string | null }>).map((d) => ({ key: driverKey(d.slug), name: firstNameLastInitial(d.display_name), photoUrl: absolutePhoto(d.photo_url) })),
          reviews: (rows as unknown as Parameters<typeof toPublicReview>[0][]).map(toPublicReview),
        });
        cache.set(slug, { at: Date.now(), body });
        return json(200, body);
      },
    },
  },
});
