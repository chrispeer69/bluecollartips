import { sql } from "@/db/client.server";

/** Accept valid recipient-specific invitations for an authenticated email.
 * Shared company codes remain approval-based and are never accepted here.
 */
export async function acceptPendingEmailInvites(userId: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { accepted: 0 };

  return sql().begin(async (tx) => {
    const invites = await tx`
      SELECT id, company_id, role
      FROM invites
      WHERE email IS NOT NULL
        AND LOWER(email) = ${normalizedEmail}
        AND used_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at ASC
      FOR UPDATE
    `;
    let accepted = 0;

    for (const invite of invites) {
      if (invite.role === "driver") {
        const linked = await tx`
          UPDATE drivers
          SET user_id = ${userId}, status = 'active'
          WHERE company_id = ${invite.company_id}
            AND LOWER(email) = ${normalizedEmail}
            AND (user_id IS NULL OR user_id = ${userId})
          RETURNING id
        `;
        const existing = linked.length ? linked : await tx`
          SELECT id FROM drivers
          WHERE company_id = ${invite.company_id} AND user_id = ${userId}
          LIMIT 1
        `;
        // Do not grant access if the invitation has no matching employee profile.
        if (!existing.length) continue;
      }

      await tx`
        INSERT INTO user_roles (user_id, company_id, role)
        VALUES (${userId}, ${invite.company_id}, ${invite.role})
        ON CONFLICT DO NOTHING
      `;
      await tx`
        UPDATE invites SET used_at = NOW(), used_by = ${userId}
        WHERE id = ${invite.id} AND used_at IS NULL
      `;
      accepted += 1;
    }

    return { accepted };
  });
}
