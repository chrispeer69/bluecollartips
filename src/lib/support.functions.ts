import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/auth/middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tenant support tickets.
//
// Who can do what:
//   super_admin   — see and answer every ticket on the platform
//   company_admin — open tickets for their company; see every ticket for it
//                   (including ones employees opened); reply; close/reopen
//   employee      — open tickets for their company; see and reply to their own
// ---------------------------------------------------------------------------

export const TICKET_CATEGORIES = [
  ["getting_started", "Getting started"],
  ["employees", "Employees & invites"],
  ["qr_links", "QR codes & tip links"],
  ["integrations", "TowBook / GHL / webhooks"],
  ["tips_payments", "Tips & customer payments"],
  ["payouts", "Payouts & withdrawals"],
  ["ratings", "Ratings & reviews"],
  ["account", "Account & sign-in"],
  ["billing", "Fees & billing"],
  ["bug", "Something is broken"],
  ["feature", "Feature request"],
  ["other", "Something else"],
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number][0];

export const TICKET_STATUSES = ["open", "waiting_on_platform", "waiting_on_tenant", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://bluecollartips.app";

type Role = { role: string; company_id: string | null };

async function rolesFor(userId: string): Promise<Role[]> {
  const { db } = await import("@/db/client.server");
  const { data } = await db.from("user_roles").select("role, company_id").eq("user_id", userId);
  return (data ?? []) as Role[];
}

async function driverCompaniesFor(userId: string): Promise<string[]> {
  const { db } = await import("@/db/client.server");
  const { data } = await db.from("drivers").select("company_id").eq("user_id", userId);
  return (data ?? []).map((d: any) => d.company_id as string);
}

/** Resolve the caller's relationship to a company. */
async function accessFor(userId: string, companyId: string) {
  const roles = await rolesFor(userId);
  const isSuper = roles.some((r) => r.role === "super_admin");
  const isAdmin = roles.some((r) => r.role === "company_admin" && r.company_id === companyId);
  const isEmployee = (await driverCompaniesFor(userId)).includes(companyId);
  return { isSuper, isAdmin, isEmployee };
}

async function loadTicket(ticketId: string) {
  const { sql } = await import("@/db/client.server");
  const [ticket] = await sql()`
    SELECT t.*, c.name AS company_name, c.slug AS company_slug,
           u.full_name AS creator_name, u.email AS creator_email,
           a.full_name AS assigned_name
    FROM support_tickets t
    JOIN companies c ON c.id = t.company_id
    JOIN users u ON u.id = t.created_by
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE t.id = ${ticketId}
  `;
  return ticket ?? null;
}

async function ticketAccess(userId: string, ticket: any) {
  const a = await accessFor(userId, ticket.company_id);
  const isCreator = ticket.created_by === userId;
  const canView = a.isSuper || a.isAdmin || isCreator;
  return { ...a, isCreator, canView };
}

async function notify(to: string | null | undefined, subject: string, lines: string[], link: string) {
  if (!to) return;
  try {
    const { sendEmail } = await import("./email/send.server");
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
      ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
      <p><a href="${link}" style="display:inline-block;background:#0b2545;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in Blue Collar Tips</a></p>
      <p style="color:#666;font-size:13px">Blue Collar Tips support</p>
    </div>`;
    await sendEmail({ to, subject, html, text: `${lines.join("\n\n")}\n\n${link}` });
  } catch (err) {
    console.error("[support] notification failed", err);
  }
}

/** Where new-ticket alerts go: SUPPORT_EMAIL, else every super admin. */
async function platformInboxEmails(): Promise<string[]> {
  const configured = process.env.SUPPORT_EMAIL?.trim();
  if (configured) return [configured];
  const { sql } = await import("@/db/client.server");
  const rows = await sql()`
    SELECT DISTINCT u.email FROM users u
    JOIN user_roles r ON r.user_id = u.id AND r.role = 'super_admin'
  `;
  return rows.map((r: any) => r.email as string);
}

const ticketSummary = (t: any) => ({
  id: t.id,
  companyId: t.company_id,
  companyName: t.company_name,
  subject: t.subject,
  category: t.category,
  priority: t.priority,
  status: t.status,
  createdBy: t.created_by,
  createdByRole: t.created_by_role,
  creatorName: t.creator_name,
  creatorEmail: t.creator_email,
  lastMessageAt: String(t.last_message_at),
  createdAt: String(t.created_at),
  resolvedAt: t.resolved_at ? String(t.resolved_at) : null,
  messageCount: Number(t.message_count ?? 0),
  lastMessagePreview: t.last_message_preview ?? null,
  assignedName: t.assigned_name ?? null,
  tenantLastReadAt: t.tenant_last_read_at ? String(t.tenant_last_read_at) : null,
  platformLastReadAt: t.platform_last_read_at ? String(t.platform_last_read_at) : null,
  // Set by list queries: a reply from the other side the viewer hasn't opened.
  unread: Boolean(t.unread),
});

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || null;

/** First line of the first message, for tickets started from the chat widget. */
export function subjectFromMessage(body: string, hasPictures: boolean) {
  const line = body.trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  if (!line) return hasPictures ? "Screenshot" : "Support request";
  return line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
}

const pageUrlField = z.string().trim().max(500).optional().nullable();
const clientInfoField = z.string().trim().max(300).optional().nullable();
const attachmentsField = z.array(z.object({ dataBase64: z.string().max(4_300_000) })).max(4).optional();

/** Tickets the caller may see. Company scope for tenants; platform-wide for super admins. */
export const listSupportTickets = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid().optional(),
      status: z.enum(["all", "active", ...TICKET_STATUSES]).default("active"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const roles = await rolesFor(context.userId);
    const isSuper = roles.some((r) => r.role === "super_admin");

    // Which company rows may this caller see, and with what breadth?
    let companyFilter: string[] | null = null; // null = all companies (super)
    let creatorOnly = false;
    if (data.companyId) {
      const a = await accessFor(context.userId, data.companyId);
      if (!a.isSuper && !a.isAdmin && !a.isEmployee) throw new Error("Forbidden");
      companyFilter = [data.companyId];
      creatorOnly = !a.isSuper && !a.isAdmin;
    } else if (!isSuper) {
      throw new Error("Forbidden");
    }

    const statusClause =
      data.status === "all"
        ? database``
        : data.status === "active"
          ? database`AND t.status IN ('open', 'waiting_on_platform', 'waiting_on_tenant')`
          : database`AND t.status = ${data.status}`;

    // Unread = the other side posted after this side last opened the ticket.
    const otherSide = isSuper ? "tenant" : "platform";
    const rows = await database`
      SELECT t.*, c.name AS company_name, u.full_name AS creator_name, u.email AS creator_email,
             a.full_name AS assigned_name,
             (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = false)::int AS message_count,
             (SELECT LEFT(COALESCE(NULLIF(m.body, ''), '📷 Screenshot'), 140) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = false AND m.author_kind <> 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
             EXISTS (
               SELECT 1 FROM support_messages m
               WHERE m.ticket_id = t.id AND m.internal = false AND m.author_kind = ${otherSide}
                 AND m.created_at > COALESCE(${otherSide === "tenant" ? database`t.platform_last_read_at` : database`t.tenant_last_read_at`}, '-infinity'::timestamptz)
             ) AS unread
      FROM support_tickets t
      JOIN companies c ON c.id = t.company_id
      JOIN users u ON u.id = t.created_by
      LEFT JOIN users a ON a.id = t.assigned_to
      WHERE 1 = 1
        ${companyFilter ? database`AND t.company_id IN ${database(companyFilter)}` : database``}
        ${creatorOnly ? database`AND t.created_by = ${context.userId}` : database``}
        ${statusClause}
      ORDER BY
        CASE t.status WHEN 'waiting_on_platform' THEN 0 WHEN 'open' THEN 1 WHEN 'waiting_on_tenant' THEN 2 ELSE 3 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.last_message_at DESC
      LIMIT 200
    `;
    const [counts] = await database`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open', 'waiting_on_platform'))::int AS needs_platform,
        COUNT(*) FILTER (WHERE status = 'waiting_on_tenant')::int AS needs_tenant,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int AS closed
      FROM support_tickets t
      WHERE 1 = 1
        ${companyFilter ? database`AND t.company_id IN ${database(companyFilter)}` : database``}
        ${creatorOnly ? database`AND t.created_by = ${context.userId}` : database``}
    `;
    return {
      tickets: rows.map(ticketSummary),
      counts: {
        needsPlatform: Number(counts?.needs_platform ?? 0),
        needsTenant: Number(counts?.needs_tenant ?? 0),
        closed: Number(counts?.closed ?? 0),
      },
      isSuper,
    };
  });

export const getSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    ticketId: z.string().uuid(),
    // Opening a ticket counts as reading it (drives "Seen" and unread badges).
    markRead: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { sql } = await import("@/db/client.server");
    let ticket = await loadTicket(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const access = await ticketAccess(context.userId, ticket);
    if (!access.canView) throw new Error("Forbidden");
    if (data.markRead) {
      if (access.isSuper) await sql()`UPDATE support_tickets SET platform_last_read_at = NOW() WHERE id = ${ticket.id}`;
      else await sql()`UPDATE support_tickets SET tenant_last_read_at = NOW() WHERE id = ${ticket.id}`;
      ticket = (await loadTicket(data.ticketId)) ?? ticket;
    }
    const messages = await sql()`
      SELECT m.id, m.author_kind, m.internal, m.body, m.created_at, m.page_url, m.client_info, u.full_name AS author_name
      FROM support_messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ${ticket.id}
        ${access.isSuper ? sql()`` : sql()`AND m.internal = false`}
      ORDER BY m.created_at ASC
    `;
    const attachments = await sql()`
      SELECT a.id, a.message_id FROM support_attachments a
      JOIN support_messages m ON m.id = a.message_id
      WHERE a.ticket_id = ${ticket.id} ${access.isSuper ? sql()`` : sql()`AND m.internal = false`}
      ORDER BY a.created_at ASC
    `;
    const byMessage = new Map<string, string[]>();
    for (const a of attachments as any[]) byMessage.set(a.message_id, [...(byMessage.get(a.message_id) ?? []), a.id]);
    return {
      ticket: ticketSummary(ticket),
      messages: messages.map((m: any) => ({
        id: m.id,
        authorKind: m.author_kind as "tenant" | "platform" | "system",
        authorName: m.author_name ?? (m.author_kind === "platform" ? "Blue Collar Tips" : "System"),
        authorFirstName: firstName(m.author_name),
        internal: Boolean(m.internal),
        body: m.body as string,
        createdAt: String(m.created_at),
        attachments: (byMessage.get(m.id) ?? []).map((id) => `/api/support-attachments/${id}`),
        // Platform staff see where the tenant was when they wrote in.
        pageUrl: access.isSuper ? (m.page_url ?? null) : null,
        clientInfo: access.isSuper ? (m.client_info ?? null) : null,
      })),
      viewer: { isSuper: access.isSuper, isAdmin: access.isAdmin, isCreator: access.isCreator },
    };
  });

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      // Optional: tickets started from the chat widget take their first line.
      subject: z.string().trim().min(3).max(200).optional(),
      category: z.enum(TICKET_CATEGORIES.map((c) => c[0]) as [TicketCategory, ...TicketCategory[]]).default("other"),
      priority: z.enum(TICKET_PRIORITIES).default("normal"),
      body: z.string().trim().max(10000).default(""),
      attachments: attachmentsField,
      pageUrl: pageUrlField,
      clientInfo: clientInfoField,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const a = await accessFor(context.userId, data.companyId);
    if (!a.isSuper && !a.isAdmin && !a.isEmployee) throw new Error("Forbidden");
    const { decodeAttachments, assertCanPost, insertAttachments } = await import("@/lib/support-attachments.server");
    const files = decodeAttachments(data.attachments);
    if (!data.body && !files.length) throw new Error("Type a message or attach a screenshot.");
    await assertCanPost(context.userId, files.length);
    const subject = data.subject ?? subjectFromMessage(data.body, files.length > 0);
    const role = a.isAdmin ? "company_admin" : a.isEmployee ? "employee" : "super_admin";
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const ticket = await database.begin(async (tx) => {
      const [t] = await tx`
        INSERT INTO support_tickets (company_id, created_by, created_by_role, subject, category, priority, status, tenant_last_read_at)
        VALUES (${data.companyId}, ${context.userId}, ${role}, ${subject}, ${data.category}, ${data.priority}, 'waiting_on_platform', NOW())
        RETURNING id
      `;
      const [m] = await tx`
        INSERT INTO support_messages (ticket_id, author_id, author_kind, body, page_url, client_info)
        VALUES (${t.id}, ${context.userId}, 'tenant', ${data.body}, ${data.pageUrl ?? null}, ${data.clientInfo ?? null})
        RETURNING id
      `;
      await insertAttachments(tx, { ticketId: t.id, messageId: m.id, userId: context.userId, files });
      return t;
    });

    const full = await loadTicket(ticket.id);
    const link = `${APP_BASE_URL}/dashboard/admin?support=${ticket.id}`;
    for (const to of await platformInboxEmails()) {
      await notify(
        to,
        `[Support] ${full.company_name}: ${subject}`,
        [
          `${full.creator_name} (${role.replace("_", " ")}) at ${full.company_name} opened a ${data.priority} priority ticket.`,
          `Category: ${TICKET_CATEGORIES.find((c) => c[0] === data.category)?.[1] ?? data.category}`,
          ...(data.body ? [data.body] : []),
          ...(files.length ? [`${files.length} screenshot${files.length === 1 ? "" : "s"} attached.`] : []),
          ...(data.pageUrl ? [`Sent from: ${data.pageUrl}`] : []),
        ],
        link,
      );
    }
    return { ok: true, ticketId: ticket.id as string };
  });

export const replySupportTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      ticketId: z.string().uuid(),
      body: z.string().trim().max(10000).default(""),
      // Super admins only: a note the tenant never sees.
      internal: z.boolean().default(false),
      // Optional status to set alongside the reply.
      status: z.enum(TICKET_STATUSES).optional(),
      attachments: attachmentsField,
      pageUrl: pageUrlField,
      clientInfo: clientInfoField,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ticket = await loadTicket(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const access = await ticketAccess(context.userId, ticket);
    if (!access.canView) throw new Error("Forbidden");
    if (data.internal && !access.isSuper) throw new Error("Only platform staff can add internal notes");
    const { decodeAttachments, assertCanPost, insertAttachments } = await import("@/lib/support-attachments.server");
    const files = decodeAttachments(data.attachments);
    if (!data.body && !files.length) throw new Error("Type a message or attach a screenshot.");
    await assertCanPost(context.userId, files.length);

    const kind = access.isSuper ? "platform" : "tenant";
    // A reply flips who the ball is with (and reopens a closed ticket), unless
    // the caller chose a status explicitly. Internal notes leave status alone.
    const nextStatus: TicketStatus =
      data.status ?? (data.internal ? ticket.status : kind === "platform" ? "waiting_on_tenant" : "waiting_on_platform");

    const { sql } = await import("@/db/client.server");
    const database = sql();
    await database.begin(async (tx) => {
      // The first platform reply "joins" the conversation, like a chat agent.
      if (kind === "platform" && !data.internal && !ticket.assigned_to) {
        const [me] = await tx`SELECT full_name FROM users WHERE id = ${context.userId}`;
        await tx`
          INSERT INTO support_messages (ticket_id, author_id, author_kind, body, created_at)
          VALUES (${ticket.id}, ${context.userId}, 'system', ${`${firstName(me?.full_name) ?? "Blue Collar Tips"} joined the conversation`}, NOW() - interval '1 millisecond')
        `;
      }
      const [m] = await tx`
        INSERT INTO support_messages (ticket_id, author_id, author_kind, internal, body, page_url, client_info)
        VALUES (${ticket.id}, ${context.userId}, ${kind}, ${data.internal}, ${data.body}, ${data.pageUrl ?? null}, ${data.clientInfo ?? null})
        RETURNING id
      `;
      await insertAttachments(tx, { ticketId: ticket.id, messageId: m.id, userId: context.userId, files });
      await tx`
        UPDATE support_tickets
        SET status = ${nextStatus},
            last_message_at = CASE WHEN ${data.internal} THEN last_message_at ELSE NOW() END,
            resolved_at = CASE WHEN ${nextStatus} IN ('resolved', 'closed') THEN COALESCE(resolved_at, NOW()) ELSE NULL END,
            assigned_to = CASE WHEN ${kind} = 'platform' AND NOT ${data.internal} THEN COALESCE(assigned_to, ${context.userId}) ELSE assigned_to END,
            platform_last_read_at = CASE WHEN ${kind} = 'platform' THEN NOW() ELSE platform_last_read_at END,
            tenant_last_read_at = CASE WHEN ${kind} = 'tenant' THEN NOW() ELSE tenant_last_read_at END,
            updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
    });

    if (!data.internal) {
      const pictures = files.length ? [`${files.length} screenshot${files.length === 1 ? "" : "s"} attached.`] : [];
      if (kind === "platform") {
        // Employees don't have the admin dashboard; their chat bubble opens the thread.
        const tenantLink = ticket.created_by_role === "employee"
          ? `${APP_BASE_URL}/dashboard/driver?chat=${ticket.id}`
          : `${APP_BASE_URL}/dashboard/admin?support=${ticket.id}`;
        await notify(
          ticket.creator_email,
          `Re: ${ticket.subject}`,
          [`Blue Collar Tips replied to your support ticket "${ticket.subject}":`, ...(data.body ? [data.body] : []), ...pictures],
          tenantLink,
        );
      } else {
        for (const to of await platformInboxEmails()) {
          await notify(
            to,
            `[Support] ${ticket.company_name}: ${ticket.subject}`,
            [`New reply from ${ticket.company_name}:`, ...(data.body ? [data.body] : []), ...pictures, ...(data.pageUrl ? [`Sent from: ${data.pageUrl}`] : [])],
            `${APP_BASE_URL}/dashboard/admin?support=${ticket.id}`,
          );
        }
      }
    }
    return { ok: true, status: nextStatus };
  });

export const setSupportTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      ticketId: z.string().uuid(),
      status: z.enum(TICKET_STATUSES),
      priority: z.enum(TICKET_PRIORITIES).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ticket = await loadTicket(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const access = await ticketAccess(context.userId, ticket);
    if (!access.canView) throw new Error("Forbidden");
    // Tenants may only close/resolve or reopen; everything else is platform-side.
    if (!access.isSuper && !["resolved", "closed", "waiting_on_platform"].includes(data.status)) {
      throw new Error("Forbidden");
    }
    if (data.priority && !access.isSuper) throw new Error("Forbidden");
    const { sql } = await import("@/db/client.server");
    const database = sql();
    await database.begin(async (tx) => {
      await tx`
        UPDATE support_tickets
        SET status = ${data.status},
            priority = COALESCE(${data.priority ?? null}, priority),
            resolved_at = CASE WHEN ${data.status} IN ('resolved', 'closed') THEN COALESCE(resolved_at, NOW()) ELSE NULL END,
            updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
      const who = access.isSuper ? "Blue Collar Tips" : "Tenant";
      await tx`
        INSERT INTO support_messages (ticket_id, author_id, author_kind, body)
        VALUES (${ticket.id}, ${context.userId}, 'system', ${`${who} marked this ticket ${data.status.replace(/_/g, " ")}.`})
      `;
    });
    return { ok: true };
  });

/**
 * Everything the floating chat widget needs for its home screen: the caller's
 * own conversations for this company, what's unread, and who answers.
 */
export const getSupportChat = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ companyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await accessFor(context.userId, data.companyId);
    if (!a.isSuper && !a.isAdmin && !a.isEmployee) throw new Error("Forbidden");
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const [me] = await database`SELECT full_name, email FROM users WHERE id = ${context.userId}`;
    const rows = await database`
      SELECT t.*, c.name AS company_name, u.full_name AS creator_name, u.email AS creator_email,
             a.full_name AS assigned_name,
             (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = false)::int AS message_count,
             (SELECT LEFT(COALESCE(NULLIF(m.body, ''), '📷 Screenshot'), 140) FROM support_messages m
                WHERE m.ticket_id = t.id AND m.internal = false AND m.author_kind <> 'system'
                ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
             EXISTS (
               SELECT 1 FROM support_messages m
               WHERE m.ticket_id = t.id AND m.internal = false AND m.author_kind = 'platform'
                 AND m.created_at > COALESCE(t.tenant_last_read_at, '-infinity'::timestamptz)
             ) AS unread
      FROM support_tickets t
      JOIN companies c ON c.id = t.company_id
      JOIN users u ON u.id = t.created_by
      LEFT JOIN users a ON a.id = t.assigned_to
      WHERE t.company_id = ${data.companyId} AND t.created_by = ${context.userId}
      ORDER BY t.last_message_at DESC
      LIMIT 30
    `;
    // The people who actually answer, for the "our team" avatars.
    const team = await database`
      SELECT u.full_name, MAX(m.created_at) AS last_reply
      FROM support_messages m JOIN users u ON u.id = m.author_id
      WHERE m.author_kind = 'platform' AND m.internal = false
      GROUP BY u.full_name ORDER BY last_reply DESC LIMIT 3
    `;
    const tickets = rows.map(ticketSummary);
    return {
      me: { firstName: firstName(me?.full_name), email: (me?.email ?? null) as string | null },
      tickets,
      unreadCount: tickets.filter((t) => t.unread).length,
      team: team.map((t: any) => firstName(t.full_name)).filter(Boolean) as string[],
      replyTime: process.env.SUPPORT_REPLY_TIME?.trim() || "A few hours",
    };
  });
