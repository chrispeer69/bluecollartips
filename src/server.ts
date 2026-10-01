import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleProfilePhotoRequest } from "./lib/profile-photo.server";
import { handleSupportAttachmentRequest } from "./lib/support-attachments.server";
import { startPartnerDispatcher } from "./lib/partner-dispatcher.server";

// Signed rating webhooks to partners (US Tow Jobs); idle until configured.
startPartnerDispatcher();

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Stripe Apple Pay domain verification.
 * Apple requires this exact path (with a leading dot) which most file routers
 * cannot express as a file name.  Intercept it before TanStack Start handles
 * the request so the file contents are always served at the right URL.
 */
function handleApplePayDomainAssociation(): Response {
  const fileContents = process.env.STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION;
  if (!fileContents) {
    return new Response(
      "Apple Pay domain association file not configured.\n" +
        "Set STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION in your environment.",
      { status: 404, headers: { "Content-Type": "text/plain" } },
    );
  }
  return new Response(fileContents, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Apple Pay domain verification — must be served at this exact path.
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/apple-developer-merchantid-domain-association") {
        return handleApplePayDomainAssociation();
      }

      const profilePhotoResponse = await handleProfilePhotoRequest(request);
      if (profilePhotoResponse) return profilePhotoResponse;

      const supportAttachmentResponse = await handleSupportAttachmentRequest(request);
      if (supportAttachmentResponse) return supportAttachmentResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
