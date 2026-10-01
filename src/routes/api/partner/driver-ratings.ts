import { createFileRoute } from "@tanstack/react-router";

// Private partner feed (US Tow Jobs): customer ratings as each driver's record
// of performance. Server-to-server only: Bearer PARTNER_API_KEY, and only the
// companies listed in PARTNER_API_SLUGS.

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/partner/driver-ratings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { partnerKeyValid, partnerSlugs, partnerFeedPage } = await import("@/lib/partner-feed.server");
        if (!partnerKeyValid(request.headers.get("authorization"))) return json(401, { error: "Invalid or missing API key" });

        const url = new URL(request.url);
        const slug = (url.searchParams.get("companySlug") ?? "").trim().toLowerCase();
        if (!slug) return json(400, { error: "companySlug is required" });
        if (!partnerSlugs().includes(slug)) return json(403, { error: "This company is not shared with partners" });

        const since = url.searchParams.get("since");
        if (since && Number.isNaN(Date.parse(since))) return json(400, { error: "since must be an ISO timestamp" });
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) return json(400, { error: "limit must be 1–1000" });

        const { sql } = await import("@/db/client.server");
        const [company] = await sql()`SELECT id, slug FROM companies WHERE slug = ${slug}`;
        if (!company) return json(404, { error: "Company not found" });
        const origin = (process.env.APP_PUBLIC_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
        try {
          const page = await partnerFeedPage(sql(), {
            companyId: company.id,
            origin,
            since: since ? new Date(since).toISOString() : null,
            cursor: url.searchParams.get("cursor"),
            limit,
          });
          return json(200, { companySlug: company.slug, ...page });
        } catch (error) {
          if (error instanceof Error && error.message === "Invalid cursor") return json(400, { error: "Invalid cursor" });
          throw error;
        }
      },
    },
  },
});
