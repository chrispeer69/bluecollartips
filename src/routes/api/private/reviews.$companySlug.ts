import { createFileRoute } from "@tanstack/react-router";

// Private review feed for a company's own website (server-to-server only, so
// no CORS headers). Bearer token checked against a SHA-256 hash in
// PRIVATE_REVIEW_FEED_TOKENS; see src/lib/private-review-feed.server.ts.
// The public feed (/api/public/reviews/:companySlug) is separate and unchanged.

const CACHE_MS = 5 * 60 * 1000;
const COMPANY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Keyed by company slug only — never by token.
const cache = new Map<string, { at: number; body: string }>();
let limiter: { blocked(ip: string): boolean; fail(ip: string): void } | null = null;

function json(status: number, data: unknown) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

export const Route = createFileRoute("/api/private/reviews/$companySlug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const slug = String(params.companySlug ?? "").toLowerCase();
        if (slug.length > 120 || !COMPANY_SLUG.test(slug)) return json(404, { error: "Not found" });

        const { privateFeedAuth, privateFeedBody, createFailureLimiter, clientIp } = await import("@/lib/private-review-feed.server");
        const auth = privateFeedAuth(slug, request.headers.get("authorization"));
        if (auth === "off") return json(404, { error: "Not found" });
        if (auth !== "ok") {
          // Only failures are limited, so a spoofed X-Forwarded-For can never
          // lock out the real (valid-token) caller.
          limiter ??= createFailureLimiter();
          const ip = clientIp(request);
          if (limiter.blocked(ip)) return json(429, { error: "Too many requests" });
          limiter.fail(ip);
          return json(401, { error: "Unauthorized" });
        }

        const { sql } = await import("@/db/client.server");
        const [company] = await sql()`SELECT id, name, slug FROM companies WHERE slug = ${slug} AND status = 'active'`;
        if (!company) return json(404, { error: "Not found" });

        const hit = cache.get(slug);
        if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body);
        const origin = (process.env.APP_PUBLIC_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
        const body = JSON.stringify(await privateFeedBody(sql(), company as unknown as { id: string; name: string; slug: string }, origin));
        cache.set(slug, { at: Date.now(), body });
        return json(200, body);
      },
    },
  },
});
