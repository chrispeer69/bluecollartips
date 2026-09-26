import { sql } from "@/db/client.server";
import { authenticatedUserId } from "./profile-photo.server";
import type { DecodedImage } from "./support-images.server";

export { decodeAttachments, sniffImage, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "./support-images.server";

// Screenshots attached to support conversations. Stored in Postgres (like
// profile photos) and served only to people who can see the conversation.

const MAX_ATTACHMENTS_PER_HOUR = 40;
const MAX_MESSAGES_PER_10_MIN = 30;
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Throttle chat spam and upload volume per person. */
export async function assertCanPost(userId: string, attachmentCount: number) {
  const [row] = await sql()`
    SELECT
      (SELECT COUNT(*) FROM support_messages WHERE author_id = ${userId} AND created_at > now() - interval '10 minutes')::int AS messages,
      (SELECT COUNT(*) FROM support_attachments WHERE uploaded_by = ${userId} AND created_at > now() - interval '1 hour')::int AS uploads
  `;
  if (Number(row?.messages ?? 0) >= MAX_MESSAGES_PER_10_MIN) throw new Error("You're sending messages too quickly. Please wait a few minutes.");
  if (attachmentCount && Number(row?.uploads ?? 0) + attachmentCount > MAX_ATTACHMENTS_PER_HOUR) {
    throw new Error("Too many pictures this hour. Please try again later.");
  }
}

export async function insertAttachments(
  tx: any,
  args: { ticketId: string; messageId: string; userId: string; files: DecodedImage[] },
) {
  for (const file of args.files) {
    await tx`
      INSERT INTO support_attachments (ticket_id, message_id, uploaded_by, content_type, byte_size, data)
      VALUES (${args.ticketId}, ${args.messageId}, ${args.userId}, ${file.contentType}, ${file.bytes.length}, ${file.bytes})
    `;
  }
}

async function canViewAttachment(userId: string, attachmentId: string) {
  const [row] = await sql()`
    SELECT a.content_type, a.byte_size, a.data, m.internal, t.company_id, t.created_by
    FROM support_attachments a
    JOIN support_messages m ON m.id = a.message_id
    JOIN support_tickets t ON t.id = a.ticket_id
    WHERE a.id = ${attachmentId}
  `;
  if (!row) return null;
  const roles = await sql()`SELECT role, company_id FROM user_roles WHERE user_id = ${userId}`;
  const isSuper = roles.some((r: any) => r.role === "super_admin");
  if (isSuper) return row;
  if (row.internal) return null;
  const isAdmin = roles.some((r: any) => r.role === "company_admin" && r.company_id === row.company_id);
  return isAdmin || row.created_by === userId ? row : null;
}

export async function handleSupportAttachmentRequest(request: Request): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/support-attachments\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const id = decodeURIComponent(match[1]);
  if (!ATTACHMENT_ID.test(id)) return new Response("Not found", { status: 404 });
  const userId = await authenticatedUserId(request);
  if (!userId) return new Response("Please sign in", { status: 401 });
  const row = await canViewAttachment(userId, id);
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : Uint8Array.from(row.data), {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(row.byte_size),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
