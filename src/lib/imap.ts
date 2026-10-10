import "server-only";
import { ImapFlow, type ListResponse } from "imapflow";
import { env } from "./env";
import type { Session } from "./session";

export function newClient(email: string, password: string, opts: { idle?: boolean } = {}) {
  return new ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: env.imapSecure,
    doSTARTTLS: env.imapSecure ? undefined : true,
    tls: { rejectUnauthorized: !env.tlsInsecure },
    auth: { user: email, pass: password },
    logger: false,
    disableAutoIdle: !opts.idle,
    clientInfo: { name: "Mailwick" },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 5 * 60_000,
  });
}

export type LoginResult = { ok: true } | { ok: false; reason: "password" | "mfa" };

/** Login check: connect, authenticate, log out. */
export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const c = newClient(email, password);
  try {
    await c.connect();
    return { ok: true };
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseStatus?: string; responseText?: string };
    if (err.authenticationFailed || err.responseStatus === "NO") {
      // e.g. Stalwart: accounts with two-step verification can only use IMAP with an app password
      const mfa = /multi-factor|app password|two-factor|2fa|totp/i.test(err.responseText || "");
      return { ok: false, reason: mfa ? "mfa" : "password" };
    }
    throw e;
  } finally {
    c.logout().catch(() => {});
  }
}

// --- One pooled connection per session (single process; run one instance) ---
type Entry = { client: ImapFlow; ready: Promise<ImapFlow>; used: number };
const g = globalThis as unknown as { __mailPool?: Map<string, Entry>; __mailSweep?: NodeJS.Timeout };
const pool = g.__mailPool ?? (g.__mailPool = new Map());

if (!g.__mailSweep) {
  g.__mailSweep = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of pool) {
      if (now - e.used > 10 * 60_000) {
        pool.delete(k);
        e.client.logout().catch(() => {});
      }
    }
  }, 60_000);
  g.__mailSweep.unref();
}

export async function getClient(s: Session): Promise<ImapFlow> {
  const cur = pool.get(s.id);
  if (cur) {
    cur.used = Date.now();
    const c = await cur.ready.catch(() => null);
    if (c && c.usable) return c;
    pool.delete(s.id);
  }
  const client = newClient(s.email, s.password);
  const entry: Entry = {
    client,
    used: Date.now(),
    ready: client.connect().then(() => client),
  };
  client.on("close", () => {
    if (pool.get(s.id) === entry) pool.delete(s.id);
  });
  client.on("error", () => {
    if (pool.get(s.id) === entry) pool.delete(s.id);
  });
  pool.set(s.id, entry);
  try {
    return await entry.ready;
  } catch (e) {
    pool.delete(s.id);
    throw e;
  }
}

export function dropClient(id: string) {
  const e = pool.get(id);
  if (e) {
    pool.delete(id);
    e.client.logout().catch(() => {});
  }
}

/** Runs fn with the mailbox locked; the lock is always released. */
export async function withMailbox<T>(s: Session, path: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = await getClient(s);
  const lock = await c.getMailboxLock(path, { acquireTimeout: 20_000 });
  try {
    return await fn(c);
  } finally {
    lock.release();
  }
}

export type SpecialFolders = { inbox: string; sent?: string; drafts?: string; trash?: string; junk?: string; archive?: string };

const specialCache = new Map<string, { at: number; list: ListResponse[] }>();

export async function listFolders(s: Session, fresh = false): Promise<ListResponse[]> {
  const hit = specialCache.get(s.email);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  const c = await getClient(s);
  const list = await c.list();
  specialCache.set(s.email, { at: Date.now(), list });
  return list;
}

export async function specialFolders(s: Session): Promise<SpecialFolders> {
  const list = await listFolders(s);
  const by = (u: string) => list.find((f) => f.specialUse === u)?.path;
  return {
    inbox: by("\\Inbox") || "INBOX",
    sent: by("\\Sent"),
    drafts: by("\\Drafts"),
    trash: by("\\Trash"),
    junk: by("\\Junk"),
    archive: by("\\Archive"),
  };
}

export function invalidateFolders(email: string) {
  specialCache.delete(email);
}
