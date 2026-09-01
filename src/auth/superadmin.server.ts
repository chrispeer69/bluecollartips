import { sql } from "@/db/client.server";

/** Explicit platform-owner allowlist. Never grants access based on signup order. */
export async function provisionConfiguredSuperAdmin(userId: string, email: string) {
  const configured = (process.env.SUPER_ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAIL ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!configured.includes(email.trim().toLowerCase())) return false;
  await sql()`
    insert into user_roles (user_id, company_id, role)
    select ${userId}, null, 'super_admin'
    where not exists (
      select 1 from user_roles
      where user_id = ${userId} and company_id is null and role = 'super_admin'
    )
  `;
  return true;
}
