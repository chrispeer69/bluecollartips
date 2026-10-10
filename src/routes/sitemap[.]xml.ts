import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://bluecollartips.app";

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
        // lastmod = when the page's content last really changed (update with the page).
        const entries: SitemapEntry[] = [
          { path: "/", lastmod: "2026-10-10", changefreq: "weekly", priority: "1.0" },
          { path: "/guides/tip-pooling", lastmod: "2026-10-10", changefreq: "monthly", priority: "0.8" },
          { path: "/guides/fica-tip-credit", lastmod: "2026-10-10", changefreq: "monthly", priority: "0.8" },
          { path: "/auth", lastmod: "2026-10-01", changefreq: "yearly", priority: "0.3" },
          { path: "/privacy", lastmod: "2026-10-10", changefreq: "yearly", priority: "0.3" },
          { path: "/terms", lastmod: "2026-10-10", changefreq: "yearly", priority: "0.3" },
        ];

        // Public company rating pages: /:companySlug
        try {
          const { db } = await import("@/db/client.server");
          const { data: companies } = await db.from("companies").select("slug, created_at").eq("status", "active");
          for (const c of companies ?? []) {
            if (!c.slug) continue;
            entries.push({
              path: `/${c.slug}`,
              lastmod: c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : undefined,
              changefreq: "monthly",
              priority: "0.5",
            });
          }
        } catch {
          // Fall through with what we have.
        }

        // Dynamic public driver pages: /:companySlug/d/:driverSlug
        // Private routes (/dashboard/*, /join/:code) are intentionally excluded —
        // they're noindex and disallowed in robots.txt.
        try {
          const { db } = await import("@/db/client.server");
          const { data: drivers } = await db
            .from("drivers")
            .select("slug, created_at, companies!inner(slug, status)")
            .eq("status", "active");
          for (const d of drivers ?? []) {
            const company = (d as { companies: { slug: string; status: string | null } | null }).companies;
            if (!company || !company.slug) continue;
            if (company.status && company.status !== "active") continue;
            const driverSlug = (d as { slug: string }).slug;
            const updatedAt = (d as { created_at: string | null }).created_at;
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
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});