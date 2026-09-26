import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  replySupportTicket,
  setSupportTicketStatus,
  type TicketStatus,
} from "@/lib/support.functions";
import { searchHelp } from "@/lib/help-content";
import { prepareImage } from "@/lib/image-attach";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Audience = "admin" | "employee";
type TicketRow = Awaited<ReturnType<typeof listSupportTickets>>["tickets"][number];
type TicketDetail = Awaited<ReturnType<typeof getSupportTicket>>;

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  waiting_on_platform: "Waiting on Blue Collar Tips",
  waiting_on_tenant: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};
const STATUS_LABEL_PLATFORM: Record<TicketStatus, string> = {
  ...STATUS_LABEL,
  waiting_on_platform: "Needs reply",
  waiting_on_tenant: "Waiting on tenant",
};
const STATUS_TONE: Record<TicketStatus, string> = {
  open: "bg-primary/10 text-primary",
  waiting_on_platform: "bg-secondary/15 text-secondary",
  waiting_on_tenant: "bg-amber-500/15 text-amber-700",
  resolved: "bg-emerald-500/15 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
};
const PRIORITY_TONE: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-muted-foreground",
  high: "text-amber-700",
  urgent: "text-destructive font-semibold",
};

const categoryLabel = (id: string) => TICKET_CATEGORIES.find((c) => c[0] === id)?.[1] ?? id;
const when = (iso: string) => new Date(iso).toLocaleString();
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function StatusPill({ status, platform }: { status: TicketStatus; platform?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {(platform ? STATUS_LABEL_PLATFORM : STATUS_LABEL)[status]}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const btnPrimary = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost = "rounded-md border border-border px-3 py-1.5 text-xs";

// ---------------------------------------------------------------------------
// Help center (static articles, searchable)
// ---------------------------------------------------------------------------

export function ArticleBody({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^- /.test(l))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>;
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return <ol key={i} className="list-decimal space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{l.replace(/^\d+\. /, "")}</li>)}</ol>;
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

export function HelpCenter({ audience, onContact }: { audience: Audience; onContact?: () => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const sections = useMemo(() => searchHelp(query, audience), [query, audience]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — e.g. payout, QR code, TowBook"
          className={`${inputCls} max-w-md`}
        />
        {onContact && (
          <button type="button" onClick={onContact} className={btnPrimary}>Contact support</button>
        )}
      </div>
      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing matched. Try a different word, or contact support below.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <ul className="mt-2 divide-y divide-border">
              {s.articles.map((a) => {
                const isOpen = open === a.id || (!!query && sections.length <= 2);
                return (
                  <li key={a.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : a.id)}
                      className="flex w-full items-center justify-between text-left text-sm hover:underline"
                      aria-expanded={isOpen}
                    >
                      <span>{a.title}</span>
                      <span className="ml-2 text-muted-foreground">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && <div className="mt-2 rounded-md bg-muted/40 p-3"><ArticleBody text={a.body} /></div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New ticket form
// ---------------------------------------------------------------------------

export function NewTicketForm({ companyId, onCreated, onCancel }: { companyId: string; onCreated: (ticketId: string) => void; onCancel?: () => void }) {
  const create = useServerFn(createSupportTicket);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [priority, setPriority] = useState<string>("normal");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await create({ data: { companyId, subject, category: category as any, priority: priority as any, body } });
          setSubject(""); setBody(""); setCategory("other"); setPriority("normal");
          onCreated(r.ticketId);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not open ticket");
        } finally { setBusy(false); }
      }}
    >
      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={200} className={inputCls} placeholder="Short summary of the issue" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{TICKET_CATEGORIES.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="What's going on?">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={5}
          maxLength={10000}
          rows={5}
          className={inputCls}
          placeholder="What did you expect, what happened instead, and when? Include the employee or customer name and date if it's about a specific tip or rating."
        />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Sending…" : "Send to Blue Collar Tips"}</button>
        {onCancel && <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Ticket thread (shared by tenant and platform views)
// ---------------------------------------------------------------------------

export function TicketThread({ ticketId, platform, onBack, onChanged }: { ticketId: string; platform: boolean; onBack: () => void; onChanged?: () => void }) {
  const get = useServerFn(getSupportTicket);
  const reply = useServerFn(replySupportTicket);
  const setStatus = useServerFn(setSupportTicketStatus);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [pictures, setPictures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setDetail(await get({ data: { ticketId } }));
  }
  async function addPictures(files: File[]) {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const { dataUrl } = await prepareImage(file);
        setPictures((p) => (p.length >= 4 ? p : [...p, dataUrl]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not attach that picture");
      }
    }
  }
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load ticket"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); onChanged?.(); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  if (!detail) return <p className="text-sm text-muted-foreground">{error ?? "Loading ticket…"}</p>;
  const t = detail.ticket;
  const isClosed = t.status === "resolved" || t.status === "closed";
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-muted-foreground underline">← All tickets</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{t.subject}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {platform && <><span className="font-medium text-foreground">{t.companyName}</span> · </>}
            {t.creatorName} ({t.createdByRole.replace("_", " ")}) · {categoryLabel(t.category)} ·{" "}
            <span className={`capitalize ${PRIORITY_TONE[t.priority]}`}>{t.priority}</span> · opened {when(t.createdAt)}
          </p>
        </div>
        <StatusPill status={t.status} platform={platform} />
      </div>

      <ol className="space-y-3">
        {detail.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg border p-3 text-sm ${
              m.authorKind === "system"
                ? "border-dashed border-border bg-transparent text-xs text-muted-foreground"
                : m.internal
                  ? "border-amber-500/40 bg-amber-500/10"
                  : m.authorKind === "platform"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-background"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {m.authorKind === "platform" ? `Blue Collar Tips${m.authorName && m.authorName !== "Blue Collar Tips" ? ` · ${m.authorName}` : ""}` : m.authorName}
                {m.internal && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-800">Internal note</span>}
              </span>
              <span>{when(m.createdAt)}</span>
            </div>
            {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
            {m.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
                    <img src={src} alt="Screenshot" loading="lazy" className="h-32 w-auto max-w-[16rem] bg-white object-contain" />
                  </a>
                ))}
              </div>
            )}
            {platform && m.pageUrl && <div className="mt-1 text-[11px] text-muted-foreground">Sent from {m.pageUrl}{m.clientInfo ? ` · ${m.clientInfo}` : ""}</div>}
            {m.authorKind === "platform" && !m.internal && platform && (
              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                {t.tenantLastReadAt && new Date(t.tenantLastReadAt) >= new Date(m.createdAt) ? "Seen by tenant" : "Not seen yet"}
              </div>
            )}
          </li>
        ))}
      </ol>

      <form
        className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim() && !pictures.length) return;
          run(async () => {
            await reply({ data: { ticketId, body, internal, attachments: pictures.map((dataBase64) => ({ dataBase64 })) } });
            setBody("");
            setPictures([]);
            setInternal(false);
          });
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (files.length) { e.preventDefault(); void addPictures(files); }
          }}
          rows={4}
          maxLength={10000}
          className={inputCls}
          placeholder={isClosed ? "Reply to reopen this ticket…" : platform ? "Reply to the tenant…" : "Reply to Blue Collar Tips…"}
        />
        <div className="flex flex-wrap items-center gap-3">
          {pictures.length > 0 && (
            <span className="flex gap-1">
              {pictures.map((src, i) => (
                <button key={i} type="button" title="Remove" onClick={() => setPictures((p) => p.filter((_, j) => j !== i))}>
                  <img src={src} alt="Attachment" className="h-10 w-10 rounded border border-border object-cover" />
                </button>
              ))}
            </span>
          )}
          <label className={`${btnGhost} cursor-pointer`}>
            Attach screenshot
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { void addPictures(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </label>
          <button type="submit" disabled={busy || (!body.trim() && !pictures.length)} className={btnPrimary}>{busy ? "Sending…" : internal ? "Save internal note" : "Send reply"}</button>
          {platform && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (tenant can't see)
            </label>
          )}
          <span className="flex-1" />
          {platform ? (
            <>
              <Select value={t.priority} onValueChange={(p) => run(() => setStatus({ data: { ticketId, status: t.status, priority: p as any } }))}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={t.status} onValueChange={(s) => run(() => setStatus({ data: { ticketId, status: s as TicketStatus } }))}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL_PLATFORM[s]}</SelectItem>)}</SelectContent>
              </Select>
            </>
          ) : isClosed ? (
            <button type="button" disabled={busy} onClick={() => run(() => setStatus({ data: { ticketId, status: "waiting_on_platform" } }))} className={btnGhost}>Reopen</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(() => setStatus({ data: { ticketId, status: "resolved" } }))} className={btnGhost}>Mark resolved</button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

function TicketList({ tickets, platform, onOpen }: { tickets: TicketRow[]; platform: boolean; onOpen: (id: string) => void }) {
  if (!tickets.length) return <p className="text-sm text-muted-foreground">No tickets here.</p>;
  return (
    <ul className="divide-y divide-border">
      {tickets.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onOpen(t.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left hover:bg-muted/30">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {t.unread && <span className="h-2 w-2 rounded-full bg-red-600" aria-label="New reply" />}
                <span className={t.unread ? "font-semibold" : "font-medium"}>{t.subject}</span>
                <StatusPill status={t.status} platform={platform} />
                {t.priority !== "normal" && <span className={`text-xs capitalize ${PRIORITY_TONE[t.priority]}`}>{t.priority}</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {platform ? <><span className="font-medium text-foreground">{t.companyName}</span> · </> : null}
                {t.creatorName} · {categoryLabel(t.category)} · {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
              </div>
              {t.lastMessagePreview && <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.lastMessagePreview}</div>}
            </div>
            <span className="text-xs text-muted-foreground" title={when(t.lastMessageAt)}>{ago(t.lastMessageAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Tenant view: tickets for one company (admin sees all; employee sees own)
// ---------------------------------------------------------------------------

export function TenantSupportPanel({ companyId, initialTicketId, composeSignal }: { companyId: string; initialTicketId?: string | null; composeSignal?: number }) {
  const list = useServerFn(listSupportTickets);
  const [data, setData] = useState<Awaited<ReturnType<typeof listSupportTickets>> | null>(null);
  const [scope, setScope] = useState<"active" | "all">("active");
  const [openId, setOpenId] = useState<string | null>(initialTicketId ?? null);
  const [compose, setCompose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setData(await list({ data: { companyId, status: scope } }));
  }
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load tickets"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, scope]);
  // Each "Contact support" click bumps the signal so the form opens again.
  useEffect(() => { if (composeSignal) { setCompose(true); setOpenId(null); } }, [composeSignal]);

  if (openId) return <TicketThread ticketId={openId} platform={false} onBack={() => { setOpenId(null); load(); }} onChanged={load} />;

  return (
    <div className="space-y-4">
      {compose ? (
        <div className="rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">New support ticket</h3>
          <NewTicketForm companyId={companyId} onCreated={(id) => { setCompose(false); setOpenId(id); }} onCancel={() => setCompose(false)} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setCompose(true)} className={btnPrimary}>New ticket</button>
          <div className="flex gap-1 rounded-md border border-border p-0.5 text-xs">
            {(["active", "all"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} className={`rounded px-2 py-1 capitalize ${scope === s ? "bg-primary text-primary-foreground" : ""}`}>{s}</button>
            ))}
          </div>
          {data && data.counts.needsTenant > 0 && (
            <span className="text-xs text-amber-700">{data.counts.needsTenant} waiting on you</span>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data ? <TicketList tickets={data.tickets} platform={false} onOpen={setOpenId} /> : <p className="text-sm text-muted-foreground">Loading tickets…</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform view: every ticket across all tenants
// ---------------------------------------------------------------------------

export function SupportInbox({ initialTicketId }: { initialTicketId?: string | null }) {
  const list = useServerFn(listSupportTickets);
  const [data, setData] = useState<Awaited<ReturnType<typeof listSupportTickets>> | null>(null);
  const [status, setStatus] = useState<"active" | "all" | TicketStatus>("active");
  const [company, setCompany] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialTicketId ?? null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setData(await list({ data: { status } }));
  }
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load tickets"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filtered = useMemo(() => {
    const q = company.trim().toLowerCase();
    return (data?.tickets ?? []).filter((t) => !q || t.companyName.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.creatorName.toLowerCase().includes(q));
  }, [data, company]);

  if (openId) return <TicketThread ticketId={openId} platform onBack={() => { setOpenId(null); load(); }} onChanged={load} />;

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Needs a reply</div><div className="display mt-1 text-2xl font-bold">{data.counts.needsPlatform}</div></div>
          <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Waiting on tenants</div><div className="display mt-1 text-2xl font-bold">{data.counts.needsTenant}</div></div>
          <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Resolved / closed</div><div className="display mt-1 text-2xl font-bold">{data.counts.closed}</div></div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Filter by company, subject or person" className={`${inputCls} max-w-xs`} />
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (open + waiting)</SelectItem>
            <SelectItem value="all">All tickets</SelectItem>
            {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL_PLATFORM[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data ? <TicketList tickets={filtered} platform onOpen={setOpenId} /> : <p className="text-sm text-muted-foreground">Loading inbox…</p>}
    </div>
  );
}
