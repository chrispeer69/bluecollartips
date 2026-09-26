import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ChevronDown, ChevronRight, ImagePlus, MessageCircle, Search, SendHorizontal, Smile, X } from "lucide-react";
import { createSupportTicket, getSupportChat, getSupportTicket, replySupportTicket } from "@/lib/support.functions";
import { searchHelp } from "@/lib/help-content";
import { prepareImage } from "@/lib/image-attach";
import { ArticleBody } from "@/components/SupportCenter";

// Floating customer-care chat for tenants (company admins and employees),
// answered by Blue Collar Tips staff from the Support inbox. Built on the same
// support tickets as the Help & support page, so both stay in sync.

type Summary = Awaited<ReturnType<typeof getSupportChat>>;
type Thread = Awaited<ReturnType<typeof getSupportTicket>>;
type View = { name: "home" } | { name: "new" } | { name: "thread"; ticketId: string } | { name: "help" };
type Pending = { id: string; dataUrl: string };

const HOME_POLL_MS = 45_000;
const OPEN_POLL_MS = 8_000;
const EMOJI = ["👍", "🙏", "😀", "😅", "🙂", "😕", "😡", "🎉", "✅", "❌", "⚠️", "❓", "💵", "🚚", "📷", "❤️"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function Avatar({ name, size = "h-8 w-8", tone = "bg-primary text-primary-foreground" }: { name: string | null; size?: string; tone?: string }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full text-xs font-semibold ring-2 ring-background ${size} ${tone}`}>
      {(name ?? "B").slice(0, 1).toUpperCase()}
    </span>
  );
}

function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function SupportChatWidget({ companyId, audience }: { companyId: string; audience: "admin" | "employee" }) {
  const getSummary = useServerFn(getSupportChat);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const visible = usePageVisible();

  const refresh = useCallback(async () => {
    try { setSummary(await getSummary({ data: { companyId } })); } catch { /* signed out or no access: stay quiet */ }
  }, [companyId, getSummary]);

  // Load right away; keep checking only while the page is on screen.
  useEffect(() => { void refresh(); }, [refresh, open, visible]);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => void refresh(), open ? OPEN_POLL_MS * 2 : HOME_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, open, visible]);

  // Email links land on ?chat=<ticket> and open that conversation.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("chat");
    if (id && UUID.test(id)) {
      setView({ name: "thread", ticketId: id });
      setOpen(true);
    }
  }, []);

  const unread = summary?.unreadCount ?? 0;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Chat with Blue Collar Tips support"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-2xl sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[640px] sm:max-h-[calc(100vh-8rem)] sm:w-[390px] sm:rounded-2xl sm:border sm:border-border"
        >
          {view.name === "home" && (
            <Home
              summary={summary}
              onClose={() => setOpen(false)}
              onNew={() => setView({ name: "new" })}
              onOpen={(ticketId) => setView({ name: "thread", ticketId })}
              onHelp={() => setView({ name: "help" })}
            />
          )}
          {view.name === "help" && <HelpView audience={audience} onBack={() => setView({ name: "home" })} onClose={() => setOpen(false)} onNew={() => setView({ name: "new" })} />}
          {(view.name === "new" || view.name === "thread") && (
            <Conversation
              key={view.name === "thread" ? view.ticketId : "new"}
              companyId={companyId}
              ticketId={view.name === "thread" ? view.ticketId : null}
              summary={summary}
              visible={visible}
              onBack={() => { setView({ name: "home" }); void refresh(); }}
              onClose={() => { setOpen(false); void refresh(); }}
              onCreated={(ticketId) => { setView({ name: "thread", ticketId }); void refresh(); }}
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => { if (!open) setView({ name: "home" }); setOpen((o) => !o); }}
        aria-label={open ? "Close support chat" : unread ? `Support chat, ${unread} unread` : "Chat with support"}
        className={`fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 md:bottom-6 md:right-6 ${open ? "max-sm:hidden" : ""}`}
      >
        {open ? <ChevronDown className="h-6 w-6" aria-hidden="true" /> : <MessageCircle className="h-6 w-6" aria-hidden="true" />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-background">
            {unread}
          </span>
        )}
      </button>
    </>
  );
}

function PanelHeader({ title, subtitle, onBack, onClose, avatars }: { title: string; subtitle?: string; onBack?: () => void; onClose: () => void; avatars?: (string | null)[] }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-3">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back" className="rounded-full p-1.5 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></button>
      )}
      {avatars && avatars.length > 0 && (
        <div className="flex -space-x-2">{avatars.slice(0, 3).map((n, i) => <Avatar key={i} name={n} />)}</div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-muted"><X className="h-5 w-5" /></button>
    </div>
  );
}

function Home({ summary, onClose, onNew, onOpen, onHelp }: {
  summary: Summary | null;
  onClose: () => void;
  onNew: () => void;
  onOpen: (ticketId: string) => void;
  onHelp: () => void;
}) {
  const team = summary?.team.length ? summary.team : ["Blue Collar Tips"];
  const recent = summary?.tickets.slice(0, 6) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bg-primary px-5 pb-10 pt-4 text-primary-foreground">
        <div className="flex items-center justify-between">
          <div className="flex -space-x-2">{team.slice(0, 3).map((n, i) => <Avatar key={i} name={n} tone="bg-primary-foreground text-primary" />)}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <h2 className="mt-6 text-2xl font-bold">Hi{summary?.me.firstName ? ` ${summary.me.firstName}` : ""} 👋</h2>
        <p className="mt-1 text-lg opacity-90">How can we help?</p>
      </div>
      <div className="-mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <button type="button" onClick={onNew} className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-muted/40">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Send us a message</div>
            <div className="text-xs text-muted-foreground">We usually reply in {summary?.replyTime?.toLowerCase() ?? "a few hours"}</div>
          </div>
          <SendHorizontal className="h-5 w-5 text-primary" />
        </button>

        {recent.length > 0 && (
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your conversations</div>
            <ul className="divide-y divide-border">
              {recent.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
                    <Avatar name={t.assignedName ?? "Blue Collar Tips"} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.subject}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.lastMessagePreview ?? ""} · {ago(t.lastMessageAt)}</div>
                    </div>
                    {t.unread ? <span className="h-2.5 w-2.5 rounded-full bg-red-600" aria-label="Unread" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" onClick={onHelp} className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-muted/40">
          <Search className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 text-sm font-semibold">Search for help</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function HelpView({ audience, onBack, onClose, onNew }: { audience: "admin" | "employee"; onBack: () => void; onClose: () => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const sections = useMemo(() => searchHelp(query, audience), [query, audience]);
  const articles = sections.flatMap((s) => s.articles);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Help articles" onBack={onBack} onClose={onClose} />
      <div className="border-b border-border p-3">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help…" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {articles.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing matched. Send us a message and we'll help.</p>
        ) : (
          <ul className="divide-y divide-border">
            {articles.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium">
                  {a.title}
                  <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition ${openId === a.id ? "rotate-90" : ""}`} />
                </button>
                {openId === a.id && <div className="mt-2"><ArticleBody text={a.body} /></div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-border p-3">
        <button type="button" onClick={onNew} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Still stuck? Message us</button>
      </div>
    </div>
  );
}

function Conversation({ companyId, ticketId, summary, visible, onBack, onClose, onCreated }: {
  companyId: string;
  ticketId: string | null;
  summary: Summary | null;
  visible: boolean;
  onBack: () => void;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const getThread = useServerFn(getSupportTicket);
  const reply = useServerFn(replySupportTicket);
  const create = useServerFn(createSupportTicket);
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    if (!ticketId) return;
    try {
      setThread(await getThread({ data: { ticketId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this conversation.");
    }
  }, [getThread, ticketId]);

  useEffect(() => { void load(); }, [load, visible]);
  useEffect(() => {
    if (!ticketId || !visible) return;
    const timer = setInterval(() => void load(), OPEN_POLL_MS);
    return () => clearInterval(timer);
  }, [load, ticketId, visible]);

  // Keep the newest message in view when something arrives.
  const messages = thread?.messages ?? [];
  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }
  }, [messages.length]);

  useEffect(() => { textarea.current?.focus(); }, []);

  async function addFiles(files: Iterable<File>) {
    setError(null);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (pending.length >= 4) { setError("Attach up to 4 pictures per message."); break; }
      try {
        const prepared = await prepareImage(file);
        setPending((p) => (p.length >= 4 ? p : [...p, { id: crypto.randomUUID(), dataUrl: prepared.dataUrl }]));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not attach that picture.");
      }
    }
  }

  async function send() {
    const text = body.trim();
    if ((!text && !pending.length) || busy) return;
    setBusy(true);
    setError(null);
    const context = {
      body: text,
      attachments: pending.map((p) => ({ dataBase64: p.dataUrl })),
      pageUrl: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      clientInfo: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`.slice(0, 300),
    };
    try {
      if (ticketId) {
        await reply({ data: { ticketId, ...context } });
        await load();
      } else {
        const result = await create({ data: { companyId, ...context } });
        onCreated(result.ticketId);
      }
      setBody("");
      setPending([]);
      setShowEmoji(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const t = thread?.ticket;
  const agent = t?.assignedName?.split(/\s+/)[0] ?? null;
  const replyTime = summary?.replyTime ?? "A few hours";
  const email = summary?.me.email;
  const firstTenant = messages.find((m) => m.authorKind === "tenant");
  const lastTenant = [...messages].reverse().find((m) => m.authorKind === "tenant");
  const lastTenantSeen = lastTenant && t?.platformLastReadAt && new Date(t.platformLastReadAt) >= new Date(lastTenant.createdAt);
  const closed = t?.status === "resolved" || t?.status === "closed";

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(Array.from(e.dataTransfer.files)); }}
    >
      <PanelHeader
        title={agent ?? "Blue Collar Tips"}
        subtitle={agent ? "Blue Collar Tips support" : `Usually replies in ${replyTime.toLowerCase()}`}
        avatars={[agent ?? "Blue Collar Tips"]}
        onBack={onBack}
        onClose={onClose}
      />

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/20 px-3 py-4">
        {!ticketId && (
          <Bubble side="platform" name="Blue Collar Tips">
            Hi{summary?.me.firstName ? ` ${summary.me.firstName}` : ""}! What can we help with? Tell us what's going on. A screenshot helps: paste it, drag it in, or tap the picture button.
          </Bubble>
        )}
        {ticketId && !thread && !error && <p className="text-center text-xs text-muted-foreground">Loading…</p>}
        {messages.map((m) => {
          if (m.authorKind === "system") {
            return <div key={m.id} className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              {/joined the conversation$/.test(m.body) && <Avatar name={m.authorFirstName} size="h-5 w-5" />}
              <span>{m.body}</span>
            </div>;
          }
          const mine = m.authorKind === "tenant";
          return (
            <div key={m.id} className="space-y-3">
              <Bubble side={mine ? "tenant" : "platform"} name={mine ? null : (m.authorFirstName ?? "Blue Collar Tips")} time={m.createdAt} attachments={m.attachments}>
                {m.body}
              </Bubble>
              {m.id === firstTenant?.id && (
                <div className="mr-10 rounded-2xl rounded-bl-md bg-card px-4 py-3 text-sm shadow-sm ring-1 ring-border">
                  <div>You'll get replies here{email ? " and in your email:" : "."}</div>
                  {email && <div className="font-semibold">✉️ {email}</div>}
                  <div className="mt-2">Our usual reply time</div>
                  <div className="font-semibold">🕒 {replyTime}</div>
                </div>
              )}
              {m.id === lastTenant?.id && (
                <div className="text-right text-[11px] text-muted-foreground">
                  {lastTenantSeen ? "Seen" : "Not seen yet"} · {ago(m.createdAt)}
                </div>
              )}
            </div>
          );
        })}
        {closed && <p className="text-center text-xs text-muted-foreground">This conversation was marked {t?.status}. Send a message to reopen it.</p>}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/10 text-sm font-semibold text-primary ring-2 ring-inset ring-primary">
          Drop the screenshot to attach it
        </div>
      )}

      <div className="border-t border-border bg-background p-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        {pending.length > 0 && (
          <div className="mb-2 flex gap-2">
            {pending.map((p) => (
              <div key={p.id} className="relative">
                <img src={p.dataUrl} alt="Attachment preview" className="h-14 w-14 rounded-md border border-border object-cover" />
                <button type="button" onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))} aria-label="Remove picture" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {showEmoji && (
          <div className="mb-2 grid grid-cols-8 gap-1 rounded-md border border-border p-2">
            {EMOJI.map((e) => (
              <button key={e} type="button" onClick={() => { setBody((b) => b + e); textarea.current?.focus(); }} className="rounded p-1 text-lg hover:bg-muted">{e}</button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-input focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={textarea}
            value={body}
            rows={2}
            maxLength={10000}
            placeholder="Message…"
            onChange={(e) => setBody(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (files.length) { e.preventDefault(); void addFiles(files); }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            className="block max-h-40 w-full resize-none bg-transparent px-3 pt-2 text-sm outline-none"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach a screenshot" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><ImagePlus className="h-5 w-5" /></button>
            <button type="button" onClick={() => setShowEmoji((s) => !s)} aria-label="Emoji" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><Smile className="h-5 w-5" /></button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || (!body.trim() && !pending.length)}
              aria-label="Send"
              className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, name, time, attachments, children }: {
  side: "tenant" | "platform";
  name: string | null;
  time?: string;
  attachments?: string[];
  children: React.ReactNode;
}) {
  const mine = side === "tenant";
  const hasText = typeof children === "string" ? children.trim().length > 0 : Boolean(children);
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && <Avatar name={name} size="h-7 w-7" />}
      <div className={`max-w-[80%] space-y-1 ${mine ? "items-end" : "items-start"} flex flex-col`}>
        {attachments?.map((src) => (
          <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl ring-1 ring-border">
            <img src={src} alt="Screenshot" loading="lazy" className="max-h-56 w-auto max-w-full bg-white object-contain" />
          </a>
        ))}
        {hasText && (
          <div className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card shadow-sm ring-1 ring-border"}`}>
            {children}
          </div>
        )}
        {time && <span className="px-1 text-[10px] text-muted-foreground">{!mine && name ? `${name} · ` : ""}{clock(time)}</span>}
      </div>
    </div>
  );
}
