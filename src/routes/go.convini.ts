import { createFileRoute } from "@tanstack/react-router";

// Tracked Convini app link for GHL workflows and drip campaigns:
//   https://bluecollartips.app/go/convini?c=<company-slug>&cid={{contact.id}}
// (or &j=<job #> / &p=<phone>). Records the click for the VIP report, then
// sends the customer on to the Convini app.

const DEFAULT_CONVINI_URL = "https://convini.live";

// Link unfurlers (iMessage, Facebook, Slack, email scanners…) fetch the URL
// without a person tapping it; don't count those as clicks.
const PREVIEW_BOT = /bot|crawl|spider|preview|facebookexternalhit|slack|whatsapp|telegram|discord|skype|linkedin|embedly|curl|wget|python|headless|scanner|proofpoint|mimecast|barracuda/i;

function destination(jobId: string | null) {
  const configured = process.env.CONVINI_APP_URL?.trim();
  let url: URL;
  try {
    url = new URL(configured && /^https?:\/\//i.test(configured) ? configured : DEFAULT_CONVINI_URL);
  } catch {
    url = new URL(DEFAULT_CONVINI_URL);
  }
  url.searchParams.set("utm_source", "bluecollartips");
  url.searchParams.set("utm_medium", "crm");
  if (jobId) url.searchParams.set("ref_job", jobId);
  return url.toString();
}

const param = (url: URL, key: string, max = 200) => url.searchParams.get(key)?.trim().slice(0, max) || null;

export const Route = createFileRoute("/go/convini")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = param(url, "c", 120);
        let jobId: string | null = param(url, "j");
        let trackedJob: string | null = null;
        const userAgent = request.headers.get("user-agent") ?? "";
        if (slug && !PREVIEW_BOT.test(userAgent)) {
          try {
            const { sql } = await import("@/db/client.server");
            const { resolveVipJob, recordVipEvent } = await import("@/lib/vip-report.server");
            const [company] = await sql()`SELECT id FROM companies WHERE slug = ${slug}`;
            if (company) {
              jobId = await resolveVipJob(sql(), company.id, { jobId, ghlContactId: param(url, "cid"), phone: param(url, "p", 40) });
              // Public link: only count clicks for jobs GHL actually sent us.
              const [known] = jobId
                ? await sql()`SELECT 1 FROM review_contexts WHERE company_id = ${company.id} AND external_job_id = ${jobId}`
                : [];
              if (known && jobId) {
                trackedJob = jobId;
                await recordVipEvent(sql(), { companyId: company.id, jobId, event: "convini_clicked" });
              }
            }
          } catch (error) {
            // Never strand the customer because tracking failed.
            console.error("convini click tracking failed", error);
          }
        }
        return new Response(null, {
          status: 302,
          headers: { Location: destination(trackedJob), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
        });
      },
    },
  },
});
