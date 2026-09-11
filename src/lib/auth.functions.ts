import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";
import { slugify } from "./constants";
import { sql } from "@/db/client.server";
import { createSession, destroySession, getSessionUser, hashPassword, verifyPassword } from "@/auth/session.server";
import { randomBytes, createHash } from "node:crypto";
import { sendEmail } from "@/lib/email/send.server";
import { provisionConfiguredSuperAdmin } from "@/auth/superadmin.server";
import { acceptPendingEmailInvites } from "@/auth/email-invites.server";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getSessionUser();
  return { user };
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email(), password: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const rows = await sql()`select id, password_hash from users where lower(email) = lower(${data.email.trim()}) limit 1`;
    const user = rows[0];
    if (!user || !(await verifyPassword(data.password, user.password_hash))) throw new Error("Invalid email or password");
    await provisionConfiguredSuperAdmin(user.id, data.email);
    await acceptPendingEmailInvites(user.id, data.email);
    await createSession(user.id);
    return { ok: true };
  });

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email(), password: z.string().min(8), fullName: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const passwordHash = await hashPassword(data.password);
    try {
      const rows = await sql()`insert into users (email, password_hash, full_name) values (${data.email.toLowerCase().trim()}, ${passwordHash}, ${data.fullName}) returning id`;
      await provisionConfiguredSuperAdmin(rows[0].id, data.email);
      await acceptPendingEmailInvites(rows[0].id, data.email);
      await createSession(rows[0].id);
      return { ok: true };
    } catch (error: any) {
      if (error?.code === "23505") throw new Error("An account with this email already exists");
      throw error;
    }
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
  return { ok: true };
});

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const users = await sql()`select id, email from users where lower(email) = lower(${data.email}) limit 1`;
    if (users[0]) {
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      await sql()`insert into password_reset_tokens (user_id, token_hash, expires_at) values (${users[0].id}, ${hash}, now() + interval '1 hour')`;
      const base = process.env.APP_BASE_URL ?? process.env.APP_PUBLIC_URL ?? "http://localhost:3000";
      await sendEmail({ to: users[0].email, subject: "Reset your Blue Collar Tips password", html: `<p>Use the link below to reset your password. It expires in one hour.</p><p><a href="${base}/reset-password?token=${encodeURIComponent(token)}">Reset password</a></p>` });
    }
    return { ok: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(20), password: z.string().min(8) }).parse(d))
  .handler(async ({ data }) => {
    const hash = createHash("sha256").update(data.token).digest("hex");
    const rows = await sql()`select id, user_id from password_reset_tokens where token_hash = ${hash} and used_at is null and expires_at > now() limit 1`;
    if (!rows[0]) throw new Error("This password reset link is invalid or expired");
    const passwordHash = await hashPassword(data.password);
    await sql().begin(async (tx) => {
      await tx`update users set password_hash = ${passwordHash}, updated_at = now() where id = ${rows[0].user_id}`;
      await tx`update password_reset_tokens set used_at = now() where id = ${rows[0].id}`;
      await tx`delete from sessions where user_id = ${rows[0].user_id}`;
    });
    return { ok: true };
  });

// Returns the signed-in user's roles + associated company info, and (if driver)
// the driver row. Used by the post-login router to send people to the right dashboard.
export const getMyRoleContext = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { db } = await import("@/db/client.server");
    const { data: account } = await db.from("users").select("email").eq("id", userId).maybeSingle();
    if (account?.email) await acceptPendingEmailInvites(userId, account.email);
    const { data: roles } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", userId);
    const { data: driver } = await db
      .from("drivers")
      .select("id, slug, status, company_id, display_name, photo_url, companies(slug, name, primary_color, secondary_color, logo_url)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { count: pendingJoinCount } = await db
      .from("join_requests")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending");
    return { roles: roles ?? [], driver, pendingJoinCount: pendingJoinCount ?? 0 };
  });

// Redeem an employee/company invite. Super-admin access is provisioned separately.
export const claimRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ inviteCode: z.string().trim().max(64).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { db, sql } = await import("@/db/client.server");

    if (data.inviteCode) {
      const inviteCode = data.inviteCode;
      const result = await sql().begin(async (tx) => {
        const invites = await tx`
          select * from invites
          where upper(code) = upper(${inviteCode})
          limit 1 for update
        `;
        const invite = invites[0];
        if (!invite) {
          const companies = await tx`select id from companies where join_code = ${inviteCode} limit 1`;
          const company = companies[0];
          if (!company) throw new Error("Invalid company or invite code");
          const existing = await tx`select id from user_roles where user_id = ${userId} and company_id = ${company.id} limit 1`;
          if (existing.length) throw new Error("Your account already belongs to this company");
          await tx`
            insert into join_requests (invite_id, company_id, user_id, status)
            values (null, ${company.id}, ${userId}, 'pending')
            on conflict (company_id, user_id) do update
              set status = case when join_requests.status = 'rejected' then 'pending' else join_requests.status end,
                  reviewed_by = null, reviewed_at = null
          `;
          return { role: "driver", companyId: company.id, status: "pending" as const };
        }
        if (invite.used_at) throw new Error("Invite already used");
        if (invite.expires_at && new Date(invite.expires_at) < new Date())
          throw new Error("Invite expired");

        const users = await tx`select email from users where id = ${userId} limit 1`;
        const accountEmail = users[0]?.email as string | undefined;
        if (invite.email && accountEmail?.toLowerCase() !== String(invite.email).toLowerCase()) {
          throw new Error(`This invitation was sent to ${invite.email}. Sign in with that email to accept it.`);
        }

        const companyMembership = await tx`
          select id from user_roles
          where user_id = ${userId} and company_id = ${invite.company_id}
          limit 1
        `;
        if (!invite.email && companyMembership.length) {
          throw new Error("Your account already belongs to this company");
        }

        // A code created without a recipient email is a reusable company join
        // code. It requests access; a company admin must approve it.
        if (!invite.email) {
          if (invite.role !== "driver") throw new Error("Company admin invitations must be sent to a specific email address");
          await tx`
            insert into join_requests (invite_id, company_id, user_id)
            values (${invite.id}, ${invite.company_id}, ${userId})
            on conflict (invite_id, user_id) do update
              set status = case when join_requests.status = 'rejected' then 'pending' else join_requests.status end,
                  reviewed_by = null, reviewed_at = null
          `;
          return { role: invite.role, companyId: invite.company_id, status: "pending" as const };
        }

        const existing = await tx`
          select id from user_roles
          where user_id = ${userId}
            and company_id = ${invite.company_id}
            and role = ${invite.role}
          limit 1
        `;
        if (existing.length) throw new Error("Your account already belongs to this company");

        if (invite.role === "driver") {
          if (!invite.email) throw new Error("This employee invite is not linked to an employee profile");
          const linked = await tx`
            update drivers
            set user_id = ${userId}, status = 'active'
            where company_id = ${invite.company_id}
              and lower(email) = lower(${invite.email})
              and user_id is null
            returning id
          `;
          if (!linked.length) throw new Error("The employee profile for this invite is unavailable");
        }

        await tx`
          insert into user_roles (user_id, company_id, role)
          values (${userId}, ${invite.company_id}, ${invite.role})
        `;
        await tx`
          update invites set used_at = now(), used_by = ${userId}
          where id = ${invite.id}
        `;
        return { role: invite.role, companyId: invite.company_id, status: "approved" as const };
      });
      return result;
    }

    throw new Error(
      "No invite code provided. Ask your company admin for one, or register your company instead.",
    );
  });

// Self-service company registration. The signed-in user creates a new company
// tenant and is granted company_admin on it. Rejects if they already own or
// admin any company.
export const registerCompany = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z
      .object({
        companyName: z.string().trim().min(2).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { db } = await import("@/db/client.server");

    const { data: existing } = await db
      .from("user_roles")
      .select("role, company_id")
      .eq("user_id", userId);
    if (existing?.some((r) => r.role === "company_admin" || r.role === "driver")) {
      throw new Error("This account is already attached to a company.");
    }

    const slug = `${slugify(data.companyName)}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: company, error } = await db
      .from("companies")
      .insert({ name: data.companyName, slug })
      .select("id, slug")
      .single();
    if (error) throw new Error(error.message);

    const { error: roleErr } = await db.from("user_roles").insert({
      user_id: userId,
      company_id: company.id,
      role: "company_admin",
    });
    if (roleErr) throw new Error(roleErr.message);

    return { companyId: company.id, slug: company.slug };
  });
