import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyGhlSecret } from "@/lib/webhook-auth.server";
import { VIP_EVENTS } from "@/lib/vip";

// Follow-up events for the VIP customer report, posted by a GHL workflow
// (e.g. right after it texts the Convini app link) or by Convini when a
// customer registers. The customer is identified by job #, GHL contact id,
// phone or email — whichever the sender has.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret, Authorization",
} as const;

const optionalText = (max: number) => z.preprocess(
  (value) => value === null || value === undefined || value === "" ? undefined : String(value).trim(),
  z.string().max(max).optional(),
);

const Body = z.object({
  companySlug: z.string().trim().min(1).max(120),
  event: z.enum(VIP_EVENTS),
  jobId: optionalText(200),
  ghlContactId: optionalText(200),
  phone: optionalText(40),
  email: optionalText(200),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  stars: z.coerce.number().int().min(1).max(5).optional(),
  source: z.enum(["ghl", "convini"]).optional(),
});

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

export const Route = createFileRoute("/api/public/webhooks/ghl-events")({
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
        const body = parsed.data;

        const { sql } = await import("@/db/client.server");
        const { resolveVipJob, recordVipEvent } = await import("@/lib/vip-report.server");
        const [company] = await sql()`SELECT id FROM companies WHERE slug = ${body.companySlug}`;
        if (!company) return json(404, { error: `Company not found: ${body.companySlug}` });

        const jobId = await resolveVipJob(sql(), company.id, body);
        if (!jobId) return json(404, { ok: false, matched: false, error: "No job matched this customer" });

        const at = body.occurredAt ? new Date(body.occurredAt) : new Date();
        // Clamp future timestamps so a bad clock can't reorder the funnel.
        await recordVipEvent(sql(), {
          companyId: company.id,
          jobId,
          event: body.event,
          at: at.getTime() > Date.now() ? new Date() : at,
          stars: body.stars ?? null,
          source: body.source,
        });
        return json(200, { ok: true, matched: true, jobId, event: body.event });
      },
    },
  },
});
