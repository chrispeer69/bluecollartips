import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getGhlSettings, removeGhlSettings, saveGhlSettings, textTipReviewLink } from "@/lib/vip.functions";

type Preview = Awaited<ReturnType<typeof textTipReviewLink>>;
const NO_DRIVER = "";

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
}

/**
 * Text a customer a fresh tip & review link through GoHighLevel. With
 * `ratingId` it re-sends for that VIP row; otherwise staff look the customer
 * up by phone (their most recent job), or start a new link.
 */
export function SendLinkCard({ companyId, ratingId, drivers, onClose, onSent }: {
  companyId: string;
  ratingId?: string;
  drivers: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSent?: () => void | Promise<void>;
}) {
  const call = useServerFn(textTipReviewLink);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [driverId, setDriverId] = useState(NO_DRIVER);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const target = () => ratingId ? { ratingId } : { phone, name: name || undefined, driverId: driverId || undefined };

  const lookUp = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const p = await call({ data: { companyId, ...target(), send: false } });
      setPreview(p);
      setMessage(p.message);
    } catch (e) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : "Could not look up that customer.");
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, companyId, ratingId, phone, name, driverId]);

  useEffect(() => { if (ratingId) void lookUp(); }, [ratingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true); setErr(null);
    try {
      const r = await call({ data: { companyId, ...target(), send: true, message } });
      setResult(r);
      if (r.sent) await onSent?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the link.");
    } finally { setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border-2 border-primary/40 bg-background p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Text a new tip &amp; review link</div>
        <button type="button" onClick={onClose} className="text-xs underline">Close</button>
      </div>

      {!ratingId && !result && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">Customer phone
            <input value={phone} onChange={(e) => { setPhone(e.target.value); setPreview(null); }} inputMode="tel" placeholder="614-555-0101" className="mt-1 block w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">Name (if new)
            <input value={name} onChange={(e) => { setName(e.target.value); setPreview(null); }} className="mt-1 block w-40 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-muted-foreground">Driver (if new)
            <select value={driverId} onChange={(e) => { setDriverId(e.target.value); setPreview(null); }} className="mt-1 block w-44 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value={NO_DRIVER}>Company (no driver)</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || phone.replace(/\D/g, "").length < 10} onClick={() => void lookUp()} className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {busy && !preview ? "Looking…" : "Find customer"}
          </button>
        </div>
      )}

      {preview && !result && (
        <>
          <div className="rounded-md bg-muted/50 p-2 text-xs">
            {preview.isNew ? (
              <>No past job for this number. A <b>new link</b> will be created{preview.driverName ? <> for <b>{preview.driverName}</b></> : " for the company"}.</>
            ) : (
              <>
                <b>{preview.customerName || "Customer"}</b>{preview.customerPhone ? ` · ${preview.customerPhone}` : ""} · job #{preview.jobId}
                {preview.driverName ? ` · ${preview.driverName}` : ""}
                <div className="mt-0.5">
                  {preview.kind === "tip"
                    ? <>Already reviewed{preview.stars ? ` (${preview.stars}★)` : ""} on {fmtDate(preview.reviewedAt)}. The new link goes <b>straight to the tip</b>.</>
                    : <>Hasn't reviewed yet{preview.linkExpiresAt ? ` (old link ${new Date(preview.linkExpiresAt) < new Date() ? "expired" : "expires"} ${fmtDate(preview.linkExpiresAt)})` : ""}. The new link opens the <b>review, then tip</b>.</>}
                </div>
              </>
            )}
            <div className="mt-0.5 text-muted-foreground">The old link stops working. The new one is good for 10 days.</div>
          </div>
          <label className="block text-xs text-muted-foreground">Text message ({"{link}"} becomes the link)
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={600} className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <button type="button" disabled={busy || !message.trim()} onClick={() => void send()} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? "Sending…" : preview.ghlConnected ? `Text it to ${preview.customerPhone ?? "the customer"}` : "Create link to copy"}
          </button>
          {!preview.ghlConnected && <p className="text-xs text-muted-foreground">GoHighLevel isn't connected yet (see “Connect GoHighLevel” at the bottom), so you'll get the text to copy and send yourself.</p>}
        </>
      )}

      {result && (
        <div className={`rounded-md border p-2 text-xs ${result.sent ? "border-green-400 bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}>
          {result.sent ? <b>Texted ✓</b> : result.error ? <><b>The text didn't go out:</b> {result.error}</> : <b>Link created. Copy the text and send it.</b>}
          <div className="mt-1 whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-foreground">{result.message}</div>
          <button type="button" onClick={() => void copy(result.sent ? result.url ?? "" : result.message)} className="mt-1 underline">
            {copied ? "Copied" : result.sent ? "Copy link" : "Copy text"}
          </button>
        </div>
      )}
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}

/** Company's GoHighLevel connection for texting (Location ID + Private Integration token). */
export function GhlSettingsCard({ companyId }: { companyId: string }) {
  const get = useServerFn(getGhlSettings);
  const save = useServerFn(saveGhlSettings);
  const remove = useServerFn(removeGhlSettings);
  const [state, setState] = useState<Awaited<ReturnType<typeof getGhlSettings>> | null>(null);
  const [locationId, setLocationId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await get({ data: { companyId } });
      setState(s);
      setLocationId(s.locationId ?? "");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load" });
    }
  }, [get, companyId]);
  useEffect(() => { void load(); }, [load]);

  async function onSave() {
    setBusy(true); setMsg(null);
    try {
      await save({ data: { companyId, locationId, apiKey } });
      setApiKey("");
      setMsg({ ok: true, text: "Connected. GoHighLevel accepted the key." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally { setBusy(false); }
  }

  async function onRemove() {
    setBusy(true); setMsg(null);
    try { await remove({ data: { companyId } }); setLocationId(""); await load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not remove" }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="font-semibold text-foreground">4. Text customers from here (GoHighLevel API key)</div>
      <p>
        Lets “Text new link” send the text from your GHL number. In GHL: <b>Settings → Private Integrations → Create</b>, allow
        <b> View/Edit Contacts</b> and <b>View/Edit Conversation Messages</b>, then paste the token below. Your Location ID is in
        <b> Settings → Business Profile</b>.
      </p>
      {state?.connected && (
        <p className="mt-1 text-foreground">
          <span className="font-semibold text-green-700 dark:text-green-400">Connected ✓</span> · Location {state.locationId} · key ending …{state.last4}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label>Location ID
          <input value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 block w-56 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label>{state?.connected ? "New token (to replace)" : "Private Integration token"}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder="pit-…" className="mt-1 block w-72 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <button type="button" disabled={busy || !locationId.trim() || apiKey.trim().length < 20} onClick={() => void onSave()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? "Checking…" : "Save & test"}
        </button>
        {state?.connected && (
          <button type="button" disabled={busy} onClick={() => void onRemove()} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50">Disconnect</button>
        )}
      </div>
      {msg && <p className={`mt-1 ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
