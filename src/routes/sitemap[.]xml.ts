import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://roadsidetips.lovable.app";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/auth", changefreq: "monthly", priority: "0.5" },
          { path: "/guides/tip-pooling", changefreq: "monthly", priority: "0.8" },
          { path: "/guides/fica-tip-credit", changefreq: "monthly", priority: "0.8" },
        ];

        // Dynamic public driver pages: /:companySlug/d/:driverSlug
        // Private routes (/dashboard/*, /join/:code) are intentionally excluded —
        // they're noindex and disallowed in robots.txt.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: drivers } = await supabaseAdmin
            .from("drivers")
            .select("slug, updated_at, companies!inner(slug, status)")
            .eq("status", "active");
          for (const d of drivers ?? []) {
            const company = (d as { companies: { slug: string; status: string | null } | null }).companies;
            if (!company || !company.slug) continue;
            if (company.status && company.status !== "active") continue;
            const driverSlug = (d as { slug: string }).slug;
            const updatedAt = (d as { updated_at: string | null }).updated_at;
            entries.push({
              path: `/${company.slug}/d/${driverSlug}`,
              lastmod: updatedAt ? new Date(updatedAt).toISOString().slice(0, 10) : undefined,
              changefreq: "weekly",
              priority: "0.7",
            });
          }
        } catch {
          // If the DB lookup fails, still return the static entries above.
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});