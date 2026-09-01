import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/db/client.server";
import { createSessionCookieHeader } from "./session.server";
import { slugify } from "@/lib/constants";
import { provisionConfiguredSuperAdmin } from "./superadmin.server";

const COOKIE = "bct_google_oauth";
const MAX_AGE = 10 * 60;

type Intent = { state: string; intent: "signin" | "company" | "employee"; companyName?: string; inviteCode?: string };

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google login is not configured");
  return { clientId, clientSecret, redirectUri };
}

function cookieValue(intent: Intent) {
  return Buffer.from(JSON.stringify(intent)).toString("base64url");
}

export function googleAuthorization(request: Request) {
  const { clientId, redirectUri } = config();
  const url = new URL(request.url);
  const intent: Intent = {
    state: randomBytes(32).toString("base64url"),
    intent: url.searchParams.get("intent") === "company" ? "company" : url.searchParams.get("intent") === "employee" ? "employee" : "signin",
    companyName: url.searchParams.get("companyName")?.trim().slice(0, 120) || undefined,
    inviteCode: url.searchParams.get("inviteCode")?.trim().toUpperCase().slice(0, 64) || undefined,
  };
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "openid email profile", state: intent.state, prompt: "select_account",
  }).toString();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: { Location: authorization.toString(), "Set-Cookie": `${COOKIE}=${cookieValue(intent)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}` },
  });
}

function readIntent(request: Request): Intent | null {
  const raw = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim().split("=")).find(([name]) => name === COOKIE)?.[1];
  if (!raw) return null;
  try { return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Intent; } catch { return null; }
}

async function applyOnboarding(userId: string, email: string, intent: Intent) {
  const roles = await sql()`select 1 from user_roles where user_id = ${userId} limit 1`;
  if (intent.intent === "employee" && intent.inviteCode) {
    const invites = await sql()`select * from invites where upper(code) = upper(${intent.inviteCode}) and used_at is null and (expires_at is null or expires_at > now()) limit 1`;
    const invite = invites[0];
    if (!invite) {
      const companies = await sql()`select id from companies where join_code = ${intent.inviteCode} limit 1`;
      const company = companies[0];
      if (!company) throw new Error("The company or employee invite code is invalid");
      await sql()`
        insert into join_requests (invite_id, company_id, user_id, status)
        values (null, ${company.id}, ${userId}, 'pending')
        on conflict (company_id, user_id) do update
          set status = case when join_requests.status = 'rejected' then 'pending' else join_requests.status end,
              reviewed_by = null, reviewed_at = null
      `;
      return;
    }
    if (invite.email && String(invite.email).toLowerCase() !== email.toLowerCase()) {
      throw new Error(`This invitation was sent to ${invite.email}. Choose that Google account to accept it.`);
    }
    await sql().begin(async (tx) => {
      if (!invite.email) {
        if (invite.role !== "driver") throw new Error("Company admin invitations must be sent to a specific email address");
        await tx`
          insert into join_requests (invite_id, company_id, user_id)
          values (${invite.id}, ${invite.company_id}, ${userId})
          on conflict (invite_id, user_id) do nothing
        `;
        return;
      }
      await tx`insert into user_roles (user_id, company_id, role) values (${userId}, ${invite.company_id}, ${invite.role}) on conflict do nothing`;
      await tx`update invites set used_at = now(), used_by = ${userId} where id = ${invite.id} and used_at is null`;
      if (invite.role === "driver") await tx`update drivers set user_id = ${userId}, status = 'active' where company_id = ${invite.company_id} and lower(email) = lower(${invite.email}) and user_id is null`;
    });
  } else if (intent.intent === "company" && intent.companyName) {
    if (roles.length) return;
    const companyName = intent.companyName;
    const slug = `${slugify(companyName)}-${randomBytes(2).toString("hex").slice(0, 3)}`;
    await sql().begin(async (tx) => {
      const companies = await tx`insert into companies (name, slug) values (${companyName}, ${slug}) returning id`;
      await tx`insert into user_roles (user_id, company_id, role) values (${userId}, ${companies[0].id}, 'company_admin')`;
    });
  }
}

export async function googleCallback(request: Request) {
  const intent = readIntent(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!intent || !code || !state || state !== intent.state) return redirectAuth("Google login expired or failed security validation");
  try {
    const { clientId, clientSecret, redirectUri } = config();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    const tokens = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description ?? "Google token exchange failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) throw new Error("Google did not return a verified email address");
    const googleSubject = profile.sub;
    const googleEmail = profile.email;

    const account = await sql()`select user_id from oauth_accounts where provider = 'google' and provider_account_id = ${googleSubject} limit 1`;
    let userId = account[0]?.user_id as string | undefined;
    if (!userId) {
      const existing = await sql()`select id from users where lower(email) = lower(${googleEmail}) limit 1`;
      userId = existing[0]?.id;
      if (!userId) {
        const users = await sql()`insert into users (email, full_name, photo_url) values (${googleEmail.toLowerCase()}, ${profile.name ?? googleEmail}, ${profile.picture ?? null}) returning id`;
        userId = users[0].id;
      }
      if (!userId) throw new Error("Google account could not be created");
      await sql()`insert into oauth_accounts (user_id, provider, provider_account_id) values (${userId}, 'google', ${googleSubject}) on conflict do nothing`;
    }
    if (!userId) throw new Error("Google account could not be linked");
    await provisionConfiguredSuperAdmin(userId, googleEmail);
    await applyOnboarding(userId, googleEmail, intent);
    const sessionCookie = await createSessionCookieHeader(userId);
    return new Response(null, { status: 302, headers: { Location: "/dashboard", "Set-Cookie": sessionCookie } });
  } catch (error) {
    return redirectAuth(error instanceof Error ? error.message : "Google login failed");
  }
}

function redirectAuth(message: string) {
  return new Response(null, { status: 302, headers: { Location: `/auth?oauthError=${encodeURIComponent(message)}`, "Set-Cookie": `${COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
