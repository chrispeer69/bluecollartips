import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getRequest, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { sql } from "@/db/client.server";

const scrypt = promisify(scryptCallback);
const COOKIE = "bct_session";

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [, salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestToken() {
  const cookie = getRequest().headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim().split("=")).find(([name]) => name === COOKIE)?.[1];
}

export async function createSession(userId: string) {
  const { token, expires } = await issueSession(userId);
  setCookie(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

async function issueSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql()`insert into sessions (token_hash, user_id, expires_at) values (${tokenHash(token)}, ${userId}, ${expires})`;
  return { token, expires };
}

export async function createSessionCookieHeader(userId: string) {
  const { token, expires } = await issueSession(userId);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`;
}

export async function destroySession() {
  const token = requestToken();
  if (token) await sql()`delete from sessions where token_hash = ${tokenHash(token)}`;
  deleteCookie(COOKIE, { path: "/" });
}

export async function getSessionUser() {
  const token = requestToken();
  if (!token) return null;
  const rows = await sql()`
    select u.id, u.email, u.full_name
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)} and s.expires_at > now()
    limit 1
  `;
  return rows[0] ?? null;
}
