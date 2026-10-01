import { sql } from "@/db/client.server";
import { dispatchPartnerEvents, partnerSlugs, purgePartnerEvents } from "./partner-feed.server";

// Background sender for partner rating webhooks. Runs inside the web server;
// does nothing until PARTNER_WEBHOOK_URL and PARTNER_WEBHOOK_SECRET are set.

const TICK_MS = 15_000;
const PURGE_EVERY = 240; // ticks (~1 hour)
let started = false;

export function startPartnerDispatcher() {
  if (started || typeof setInterval !== "function") return;
  started = true;
  let ticks = 0;
  let running = false;
  const timer = setInterval(async () => {
    const url = process.env.PARTNER_WEBHOOK_URL?.trim();
    const secret = process.env.PARTNER_WEBHOOK_SECRET?.trim();
    if (!url || !secret || running || !process.env.DATABASE_URL) return;
    running = true;
    try {
      const origin = (process.env.APP_PUBLIC_URL ?? "https://bluecollartips.app").replace(/\/$/, "");
      const r = await dispatchPartnerEvents(sql(), { url, secret, slugs: partnerSlugs(), origin });
      if (r.failed || r.retry) console.warn("[partner-webhook]", r);
      if (++ticks % PURGE_EVERY === 0) await purgePartnerEvents(sql());
    } catch (error) {
      console.error("[partner-webhook] dispatch failed", error);
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref?.();
}
