import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redis } from "./redis";
import { env } from "./env";

export const COOKIE = "mw_sid";
const LONG = 60 * 60 * 24 * 30; // "remember me": 30 days
const SHORT = 60 * 60 * 24; // browser session: at most 1 day (extended on every request)

export type Session = {
  id: string; // sha256(sid): Redis key and connection pool key
  email: string;
  password: string;
  remember: boolean;
};

type Stored = { email: string; enc: string; remember: boolean; created: number };

const hash = (sid: string) => crypto.createHash("sha256").update(sid).digest("hex");

// The password is encrypted with a key derived from the cookie's sid and the server secret,
// so someone who only gets hold of Redis can't decrypt it.
function key(sid: string) {
  return Buffer.from(crypto.hkdfSync("sha256", env.secret, sid, "mailwick/pass", 32));
}

function encrypt(sid: string, text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(sid), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function decrypt(sid: string, data: string) {
  const buf = Buffer.from(data, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key(sid), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export async function createSession(email: string, password: string, remember: boolean) {
  const sid = crypto.randomBytes(32).toString("base64url");
  const ttl = remember ? LONG : SHORT;
  const stored: Stored = { email, enc: encrypt(sid, password), remember, created: Date.now() };
  await redis.set(`s:${hash(sid)}`, JSON.stringify(stored), "EX", ttl);
  const jar = await cookies();
  jar.set(COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: LONG } : {}),
  });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  if (!sid || sid.length > 100) return null;
  const id = hash(sid);
  const raw = await redis.get(`s:${id}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Stored;
    if (!s.remember) await redis.expire(`s:${id}`, SHORT);
    return { id, email: s.email, password: decrypt(sid, s.enc), remember: s.remember };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  if (sid) await redis.del(`s:${hash(sid)}`);
  jar.delete(COOKIE);
  return sid ? hash(sid) : null;
}
