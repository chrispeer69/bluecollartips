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
           u.full_name AS creator_name, u.email AS creator_email
    FROM support_tickets t
    JOIN companies c ON c.id = t.company_id
    JOIN users u ON u.id = t.created_by
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
});

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

    const rows = await database`
      SELECT t.*, c.name AS company_name, u.full_name AS creator_name, u.email AS creator_email,
             (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = false)::int AS message_count,
             (SELECT LEFT(m.body, 140) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = false ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview
      FROM support_tickets t
      JOIN companies c ON c.id = t.company_id
      JOIN users u ON u.id = t.created_by
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
  .inputValidator((d) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ticket = await loadTicket(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const access = await ticketAccess(context.userId, ticket);
    if (!access.canView) throw new Error("Forbidden");
    const { sql } = await import("@/db/client.server");
    const messages = await sql()`
      SELECT m.id, m.author_kind, m.internal, m.body, m.created_at, u.full_name AS author_name
      FROM support_messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ${ticket.id}
        ${access.isSuper ? sql()`` : sql()`AND m.internal = false`}
      ORDER BY m.created_at ASC
    `;
    return {
      ticket: ticketSummary(ticket),
      messages: messages.map((m: any) => ({
        id: m.id,
        authorKind: m.author_kind as "tenant" | "platform" | "system",
        authorName: m.author_name ?? (m.author_kind === "platform" ? "Blue Collar Tips" : "System"),
        internal: Boolean(m.internal),
        body: m.body,
        createdAt: String(m.created_at),
      })),
      viewer: { isSuper: access.isSuper, isAdmin: access.isAdmin, isCreator: access.isCreator },
    };
  });

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) =>
    z.object({
      companyId: z.string().uuid(),
      subject: z.string().trim().min(3).max(200),
      category: z.enum(TICKET_CATEGORIES.map((c) => c[0]) as [TicketCategory, ...TicketCategory[]]).default("other"),
      priority: z.enum(TICKET_PRIORITIES).default("normal"),
      body: z.string().trim().min(5).max(10000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const a = await accessFor(context.userId, data.companyId);
    if (!a.isSuper && !a.isAdmin && !a.isEmployee) throw new Error("Forbidden");
    const role = a.isAdmin ? "company_admin" : a.isEmployee ? "employee" : "super_admin";
    const { sql } = await import("@/db/client.server");
    const database = sql();
    const ticket = await database.begin(async (tx) => {
      const [t] = await tx`
        INSERT INTO support_tickets (company_id, created_by, created_by_role, subject, category, priority, status)
        VALUES (${data.companyId}, ${context.userId}, ${role}, ${data.subject}, ${data.category}, ${data.priority}, 'waiting_on_platform')
        RETURNING id
      `;
      await tx`
        INSERT INTO support_messages (ticket_id, author_id, author_kind, body)
        VALUES (${t.id}, ${context.userId}, 'tenant', ${data.body})
      `;
      return t;
    });

    const full = await loadTicket(ticket.id);
    const link = `${APP_BASE_URL}/dashboard/admin?support=${ticket.id}`;
    for (const to of await platformInboxEmails()) {
      await notify(
        to,
        `[Support] ${full.company_name}: ${data.subject}`,
        [
          `${full.creator_name} (${role.replace("_", " ")}) at ${full.company_name} opened a ${data.priority} priority ticket.`,
          `Category: ${TICKET_CATEGORIES.find((c) => c[0] === data.category)?.[1] ?? data.category}`,
          data.body,
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
      body: z.string().trim().min(1).max(10000),
      // Super admins only: a note the tenant never sees.
      internal: z.boolean().default(false),
      // Optional status to set alongside the reply.
      status: z.enum(TICKET_STATUSES).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ticket = await loadTicket(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const access = await ticketAccess(context.userId, ticket);
    if (!access.canView) throw new Error("Forbidden");
    if (data.internal && !access.isSuper) throw new Error("Only platform staff can add internal notes");

    const kind = access.isSuper ? "platform" : "tenant";
    // A reply flips who the ball is with (and reopens a closed ticket), unless
    // the caller chose a status explicitly. Internal notes leave status alone.
    const nextStatus: TicketStatus =
      data.status ?? (data.internal ? ticket.status : kind === "platform" ? "waiting_on_tenant" : "waiting_on_platform");

    const { sql } = await import("@/db/client.server");
    const database = sql();
    await database.begin(async (tx) => {
      await tx`
        INSERT INTO support_messages (ticket_id, author_id, author_kind, internal, body)
        VALUES (${ticket.id}, ${context.userId}, ${kind}, ${data.internal}, ${data.body})
      `;
      await tx`
        UPDATE support_tickets
        SET status = ${nextStatus},
            last_message_at = CASE WHEN ${data.internal} THEN last_message_at ELSE NOW() END,
            resolved_at = CASE WHEN ${nextStatus} IN ('resolved', 'closed') THEN COALESCE(resolved_at, NOW()) ELSE NULL END,
            assigned_to = CASE WHEN ${kind} = 'platform' THEN COALESCE(assigned_to, ${context.userId}) ELSE assigned_to END,
            updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
    });

    if (!data.internal) {
      if (kind === "platform") {
        await notify(
          ticket.creator_email,
          `Re: ${ticket.subject}`,
          [`Blue Collar Tips replied to your support ticket "${ticket.subject}":`, data.body],
          `${APP_BASE_URL}/dashboard/admin?support=${ticket.id}`,
        );
      } else {
        for (const to of await platformInboxEmails()) {
          await notify(
            to,
            `[Support] ${ticket.company_name}: ${ticket.subject}`,
            [`New reply from ${ticket.company_name}:`, data.body],
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
