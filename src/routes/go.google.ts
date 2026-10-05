import { createFileRoute } from "@tanstack/react-router";

// Tracked Google review link for GHL workflows and drip campaigns:
//   https://bluecollartips.app/go/google?c=<company-slug>&cid={{contact.id}}
// (or &r=<rating id> / &j=<job #> / &p=<phone>). Records the click for the VIP
// report and review-site stats, then sends the customer to the company's saved
// Google "write a review" URL. Destination is never taken from the query
// string, so this can't be used as an open redirect.

// Link unfurlers (iMessage, Facebook, Slack, email scanners…) fetch the URL
// without a person tapping it; don't count those as clicks.
const PREVIEW_BOT = /bot|crawl|spider|preview|facebookexternalhit|slack|whatsapp|telegram|discord|skype|linkedin|embedly|curl|wget|python|headless|scanner|proofpoint|mimecast|barracuda/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const param = (url: URL, key: string, max = 200) => url.searchParams.get(key)?.trim().slice(0, max) || null;

function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export const Route = createFileRoute("/go/google")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = param(url, "c", 120);
        if (!slug) return redirect("/");

        let destination: string | null = null;
        try {
          const { sql } = await import("@/db/client.server");
          const db = sql();
          const [company] = await db`SELECT id, google_review_url FROM companies WHERE slug = ${slug}`;
          if (!company) return redirect("/");
          destination = safeUrl(company.google_review_url);

          const userAgent = request.headers.get("user-agent") ?? "";
          if (!PREVIEW_BOT.test(userAgent)) {
            try {
              const { resolveVipJob, recordVipEvent } = await import("@/lib/vip-report.server");
              const ratingParam = param(url, "r", 64);
              const ratingId = ratingParam && UUID.test(ratingParam) ? ratingParam : null;

              // Rating id is the most precise key; otherwise resolve the job
              // from job # / GHL contact id / phone like the Convini link.
              let jobId: string | null = null;
              let contextId: string | null = null;
              if (ratingId) {
                const [row] = await db`
                  SELECT rc.id AS context_id, rc.external_job_id
                  FROM ratings r JOIN review_contexts rc ON rc.id = r.review_context_id
                  WHERE r.id = ${ratingId} AND r.company_id = ${company.id}`;
                if (row) { jobId = row.external_job_id; contextId = row.context_id; }
              }
              if (!jobId) {
                jobId = await resolveVipJob(db, company.id, {
                  jobId: param(url, "j"),
                  ghlContactId: param(url, "cid"),
                  phone: param(url, "p", 40),
                });
              }

              // Public link: only count clicks for jobs GHL actually sent us.
              if (jobId && !contextId) {
                const [ctx] = await db`
                  SELECT id FROM review_contexts
                  WHERE company_id = ${company.id} AND external_job_id = ${jobId}
                  ORDER BY created_at DESC LIMIT 1`;
                contextId = ctx?.id ?? null;
              }
              if (jobId && contextId) {
                await recordVipEvent(db, { companyId: company.id, jobId, event: "google_clicked" });
                // Same per-rating stat the thank-you page's Google button writes.
                const [rating] = ratingId
                  ? [{ id: ratingId }]
                  : await db`
                      SELECT id FROM ratings
                      WHERE company_id = ${company.id} AND review_context_id = ${contextId}
                      ORDER BY created_at DESC LIMIT 1`;
                if (rating) {
                  await db`
                    INSERT INTO review_site_clicks (company_id, rating_id, site)
                    VALUES (${company.id}, ${rating.id}, 'google')
                    ON CONFLICT (rating_id, site) DO NOTHING`;
                }
              }
            } catch (error) {
              // Never strand the customer because tracking failed.
              console.error("google click tracking failed", error);
            }
          }
        } catch (error) {
          console.error("google link lookup failed", error);
        }

        return redirect(destination ?? "/");
      },
    },
  },
});
