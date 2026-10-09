// Minimal GoHighLevel (LeadConnector v2) client for texting customers from
// the company's own sub-account, using a Private Integration token.
const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

export type GhlCreds = { locationId: string; apiKey: string };

async function call(creds: GhlCreds, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Version: API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) {
    throw new Error("GoHighLevel rejected the API key. Check the token and its scopes (contacts and conversations/message write).");
  }
  if (!res.ok) {
    const detail = Array.isArray(json?.message) ? json.message.join(", ") : json?.message ?? text.slice(0, 200);
    throw new Error(`GoHighLevel error ${res.status}: ${detail}`);
  }
  return json;
}

/** GHL wants E.164; assume US for 10-digit numbers. */
export function e164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim().startsWith("+") ? `+${digits}` : phone.trim();
}

/** Throws unless the token can read this location's contacts. */
export async function ghlCheck(creds: GhlCreds) {
  await call(creds, "/contacts/search", { locationId: creds.locationId, pageLimit: 1 });
}

/** Find or create the contact by phone; returns the GHL contact id. */
export async function ghlUpsertContact(creds: GhlCreds, contact: { name?: string | null; phone: string }) {
  const [firstName, ...rest] = (contact.name ?? "").trim().split(/\s+/).filter(Boolean);
  const json = await call(creds, "/contacts/upsert", {
    locationId: creds.locationId,
    phone: e164(contact.phone),
    ...(firstName ? { firstName } : {}),
    ...(rest.length ? { lastName: rest.join(" ") } : {}),
  });
  const id = json?.contact?.id;
  if (!id) throw new Error("GoHighLevel did not return a contact id");
  return id as string;
}

export async function ghlSendSms(creds: GhlCreds, contactId: string, message: string) {
  const json = await call(creds, "/conversations/messages", { type: "SMS", contactId, message });
  return (json?.messageId ?? null) as string | null;
}
