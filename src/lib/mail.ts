import "server-only";
import type { FetchMessageObject, ImapFlow, MailboxObject, MessageAddressObject, MessageStructureObject, SearchObject } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { getClient, invalidateFolders, listFolders, specialFolders, withMailbox } from "./imap";
import { HttpError, type UidSel } from "./api";
import { parseSearch } from "./search";
import { htmlToText, sanitizeEmail, textToHtml } from "./sanitize";
import type { Session } from "./session";
import type { Addr, Attachment, Folder, MessageFull, MessageList, MessageSummary, ThreadItem } from "./types";

export const PAGE_SIZE = 50;
const MAX_SOURCE = 40 * 1024 * 1024;

// ---------- helpers ----------

const SPECIAL: Record<string, Folder["special"]> = {
  "\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\Junk": "junk",
  "\\Archive": "archive",
  "\\Flagged": "flagged",
  "\\All": "all",
};
const ORDER: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5 };

function addrs(list?: MessageAddressObject[]): Addr[] {
  return (list || []).filter((a) => a.address).map((a) => ({ name: a.name || undefined, address: a.address!.toLowerCase() }));
}

function parsedAddrs(v?: AddressObject | AddressObject[]): Addr[] {
  const arr = !v ? [] : Array.isArray(v) ? v : [v];
  const out: Addr[] = [];
  const walk = (items: AddressObject["value"]) => {
    for (const a of items) {
      if (a.group) walk(a.group);
      else if (a.address) out.push({ name: a.name || undefined, address: a.address.toLowerCase() });
    }
  };
  for (const o of arr) walk(o.value);
  return out;
}

function iso(d?: Date | string) {
  if (!d) return new Date(0).toISOString();
  const x = typeof d === "string" ? new Date(d) : d;
  return isNaN(x.getTime()) ? new Date(0).toISOString() : x.toISOString();
}

function walk(node: MessageStructureObject | undefined, fn: (n: MessageStructureObject) => void) {
  if (!node) return;
  fn(node);
  node.childNodes?.forEach((c) => walk(c, fn));
}

function hasAttachments(bs?: MessageStructureObject) {
  let found = false;
  walk(bs, (n) => {
    if (n.childNodes) return;
    const name = n.dispositionParameters?.filename || n.parameters?.name;
    if (n.disposition === "attachment") found = true;
    else if (name && !n.type.startsWith("text/") && n.disposition !== "inline" && !n.id) found = true;
  });
  return found;
}

function textPart(bs?: MessageStructureObject) {
  let plain: MessageStructureObject | undefined;
  let html: MessageStructureObject | undefined;
  walk(bs, (n) => {
    if (n.childNodes || n.disposition === "attachment") return;
    if (n.type === "text/plain" && !plain) plain = n;
    if (n.type === "text/html" && !html) html = n;
  });
  const p = plain || html;
  if (!p) return null;
  return { part: p.part || "1", html: p === html, charset: p.parameters?.charset || "utf-8", encoding: (p.encoding || "").toLowerCase() };
}

function decodeChunk(buf: Buffer, encoding: string, binary: boolean): Buffer {
  if (binary) return buf;
  if (encoding === "base64") {
    const s = buf.toString("ascii").replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(s.slice(0, s.length - (s.length % 4)), "base64");
  }
  if (encoding === "quoted-printable") {
    const s = buf.toString("binary").replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(s.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes);
  }
  return buf;
}

function decodeCharset(buf: Buffer, charset: string) {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

function makeSnippet(raw: string, html: boolean) {
  let t = html ? htmlToText(raw) : raw;
  t = t
    .split(/\r?\n--\s*\r?\n/)[0] // drop the signature
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/�/g, "")
    .trim();
  return t.slice(0, 180);
}

// Snippets never change: cached in memory by (account, folder, uidvalidity, uid).
const snippetCache = new Map<string, string>();
function cacheSnippet(k: string, v: string) {
  snippetCache.set(k, v);
  if (snippetCache.size > 20000) {
    const first = snippetCache.keys().next().value;
    if (first) snippetCache.delete(first);
  }
}

function summarize(m: FetchMessageObject, snippet: string): MessageSummary {
  const f = m.flags || new Set<string>();
  return {
    uid: m.uid,
    threadId: m.threadId,
    messageId: m.envelope?.messageId,
    subject: m.envelope?.subject || "",
    from: addrs(m.envelope?.from),
    to: addrs(m.envelope?.to),
    date: iso(m.envelope?.date || m.internalDate),
    seen: f.has("\\Seen"),
    flagged: f.has("\\Flagged"),
    answered: f.has("\\Answered"),
    draft: f.has("\\Draft"),
    attachments: hasAttachments(m.bodyStructure),
    snippet,
    size: m.size || 0,
  };
}

const SUMMARY_QUERY = { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, threadId: true } as const;

async function withSnippets(c: ImapFlow, email: string, folder: string, msgs: FetchMessageObject[]): Promise<MessageSummary[]> {
  const mb = c.mailbox as MailboxObject;
  const base = `${email}|${folder}|${mb.uidValidity}|`;
  const need = new Map<string, { uid: number; info: NonNullable<ReturnType<typeof textPart>> }[]>();
  for (const m of msgs) {
    if (snippetCache.has(base + m.uid)) continue;
    const info = textPart(m.bodyStructure);
    if (!info) {
      cacheSnippet(base + m.uid, "");
      continue;
    }
    const arr = need.get(info.part) || [];
    arr.push({ uid: m.uid, info });
    need.set(info.part, arr);
  }
  // messages sharing the same part number are fetched in a single FETCH
  for (const [part, items] of need) {
    const byUid = new Map(items.map((i) => [i.uid, i.info]));
    try {
      for await (const r of c.fetch(
        items.map((i) => i.uid),
        { uid: true, bodyParts: [{ key: part, maxLength: 2048 }] },
        { uid: true, binary: true },
      )) {
        const info = byUid.get(r.uid);
        const buf = r.bodyParts?.get(part) || [...(r.bodyParts?.values() || [])][0];
        if (!info || !buf) continue;
        const binary = !!r.binaryParts?.size;
        cacheSnippet(base + r.uid, makeSnippet(decodeCharset(decodeChunk(buf, info.encoding, binary), info.charset), info.html));
      }
    } catch {
      // the list still loads if snippets fail
    }
  }
  return msgs.map((m) => summarize(m, snippetCache.get(base + m.uid) || ""));
}

// ---------- folders ----------

export async function getFolders(s: Session): Promise<Folder[]> {
  const list = await listFolders(s, true);
  const c = await getClient(s);
  const out: Folder[] = [];
  for (const f of list) {
    if (f.flags.has("\\Noselect") || f.flags.has("\\NonExistent")) continue;
    let st = { unseen: 0, messages: 0 };
    try {
      const r = await c.status(f.path, { unseen: true, messages: true });
      if (r) st = { unseen: r.unseen || 0, messages: r.messages || 0 };
    } catch {}
    const special = f.path.toUpperCase() === "INBOX" ? "inbox" : f.specialUse ? SPECIAL[f.specialUse] : undefined;
    out.push({
      path: f.path,
      name: f.name,
      special,
      delimiter: f.delimiter,
      depth: f.parent.length,
      unseen: st.unseen,
      total: st.messages,
    });
  }
  out.sort((a, b) => {
    const oa = a.special && a.special in ORDER ? ORDER[a.special] : 10;
    const ob = b.special && b.special in ORDER ? ORDER[b.special] : 10;
    return oa - ob || a.path.localeCompare(b.path);
  });
  return out;
}

// ---------- folder management ----------

function folderName(v: string) {
  const name = v.replace(/\s+/g, " ").trim();
  if (!name) throw new HttpError(400, "errors.folderNameEmpty");
  if (name.length > 80) throw new HttpError(400, "errors.folderNameLong");
  if (/[/\\.*%"]/.test(name) || /[\x00-\x1f]/.test(name)) throw new HttpError(400, "errors.folderNameChars");
  if (name.toUpperCase() === "INBOX") throw new HttpError(400, "errors.folderNameReserved");
  return name;
}

/** Only user folders can be edited; special folders and the Inbox are protected. */
async function userFolder(s: Session, path: string) {
  const list = await listFolders(s, true);
  const f = list.find((x) => x.path === path);
  if (!f) throw new HttpError(404, "errors.folderNotFound");
  if (f.path.toUpperCase() === "INBOX" || f.specialUse) throw new HttpError(400, "errors.systemFolder");
  return { f, list };
}

export async function createFolder(s: Session, rawName: string, parent?: string) {
  const name = folderName(rawName);
  const list = await listFolders(s, true);
  let path = name;
  if (parent) {
    const p = list.find((x) => x.path === parent);
    if (!p) throw new HttpError(404, "errors.parentNotFound");
    if (p.path.toUpperCase() === "INBOX" || p.specialUse) throw new HttpError(400, "errors.systemParent");
    path = `${p.path}${p.delimiter || "/"}${name}`;
  }
  if (list.some((x) => x.path.toLowerCase() === path.toLowerCase())) throw new HttpError(409, "errors.folderExists");
  const c = await getClient(s);
  const r = await c.mailboxCreate(path);
  await c.mailboxSubscribe(r.path).catch(() => {});
  invalidateFolders(s.email);
  return { path: r.path };
}

export async function renameFolder(s: Session, path: string, rawName: string) {
  const name = folderName(rawName);
  const { f, list } = await userFolder(s, path);
  const newPath = f.parentPath ? `${f.parentPath}${f.delimiter || "/"}${name}` : name;
  if (newPath === path) return { path };
  if (list.some((x) => x.path !== path && x.path.toLowerCase() === newPath.toLowerCase()))
    throw new HttpError(409, "errors.folderExists");
  const c = await getClient(s);
  const r = await c.mailboxRename(path, newPath);
  await c.mailboxSubscribe(r.newPath).catch(() => {});
  invalidateFolders(s.email);
  return { path: r.newPath };
}

/** Empties Trash or Junk (permanent delete). */
export async function emptyFolder(s: Session, path: string) {
  const sp = await specialFolders(s);
  if (path !== sp.trash && path !== sp.junk) throw new HttpError(400, "errors.onlyTrashJunk");
  return withMailbox(s, path, async (c) => {
    const n = (c.mailbox as MailboxObject).exists;
    if (n) await c.messageDelete("1:*");
    return { removed: n };
  });
}

/** Marks every message in the folder as read. */
export async function markFolderRead(s: Session, path: string) {
  return withMailbox(s, path, async (c) => {
    const n = (c.mailbox as MailboxObject).exists;
    if (n) await c.messageFlagsAdd("1:*", ["\\Seen"]);
    return { count: n };
  });
}

/** Moves the folder's messages to Trash first, then deletes the folder. */
export async function deleteFolder(s: Session, path: string) {
  const { f, list } = await userFolder(s, path);
  if (list.some((x) => x.parentPath === f.path)) throw new HttpError(400, "errors.deleteSubfoldersFirst");
  const sp = await specialFolders(s);
  const moved = await withMailbox(s, path, async (c) => {
    const n = (c.mailbox as MailboxObject).exists;
    if (!n) return 0;
    if (!sp.trash) throw new HttpError(400, "errors.noTrash");
    await c.messageMove("1:*", sp.trash);
    return n;
  });
  const c = await getClient(s);
  await c.mailboxDelete(path);
  invalidateFolders(s.email);
  return { moved };
}

// ---------- listing ----------

export type ListFilter = "all" | "unread" | "flagged";

function buildQuery(q: string, filter: ListFilter): SearchObject {
  const query: SearchObject = q ? parseSearch(q).query : {};
  if (filter === "unread") query.seen = false;
  if (filter === "flagged") query.flagged = true;
  return query;
}

const ALL_PER_FOLDER = 200; // all-folder search: newest N results per folder

/** Searches every selectable folder except Trash and Junk; results are merged by date. */
export async function searchAllFolders(s: Session, page: number, q: string, filter: ListFilter): Promise<MessageList> {
  const query = buildQuery(q, filter);
  const list = await listFolders(s);
  const folders = list
    .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent") && f.specialUse !== "\\Trash" && f.specialUse !== "\\Junk")
    .map((f) => f.path);
  const hits: { folder: string; m: FetchMessageObject; date: number }[] = [];
  let truncated = false;
  for (const f of folders) {
    try {
      await withMailbox(s, f, async (c) => {
        const found = ((await c.search(query, { uid: true })) || []) as number[];
        if (!found.length) return;
        found.sort((a, b) => b - a);
        if (found.length > ALL_PER_FOLDER) truncated = true;
        const msgs = await c.fetchAll(found.slice(0, ALL_PER_FOLDER), SUMMARY_QUERY, { uid: true });
        for (const m of msgs) hits.push({ folder: f, m, date: new Date(m.envelope?.date || m.internalDate || 0).getTime() || 0 });
      });
    } catch {
      // an unreadable folder must not break the result
    }
  }
  hits.sort((a, b) => b.date - a.date || b.m.uid - a.m.uid);
  const slice = hits.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // snippets only for the page being shown, folder by folder
  const byFolder = new Map<string, FetchMessageObject[]>();
  for (const h of slice) byFolder.set(h.folder, [...(byFolder.get(h.folder) || []), h.m]);
  const summaries = new Map<string, MessageSummary>();
  for (const [f, msgs] of byFolder) {
    const got = await withMailbox(s, f, (c) => withSnippets(c, s.email, f, msgs)).catch(() => msgs.map((m) => summarize(m, "")));
    got.forEach((m) => summaries.set(`${f}|${m.uid}`, { ...m, folder: f }));
  }
  return {
    folder: "*",
    total: hits.length,
    page,
    pageSize: PAGE_SIZE,
    scope: "all",
    truncated,
    messages: slice.map((h) => summaries.get(`${h.folder}|${h.m.uid}`)!).filter(Boolean),
  };
}

export async function listMessages(s: Session, folder: string, page: number, q: string, filter: ListFilter): Promise<MessageList> {
  return withMailbox(s, folder, async (c) => {
    // If the pooled connection already has the folder open, the server only reports new mail (EXISTS)
    // in response to a command; without NOOP `exists` stays stale and new mail doesn't show up.
    await c.noop();
    const mb = c.mailbox as MailboxObject;
    const result: MessageList = { folder, total: 0, page, pageSize: PAGE_SIZE, messages: [] };

    let msgs: FetchMessageObject[] = [];
    if (q || filter !== "all") {
      const query = buildQuery(q, filter);
      const found = ((await c.search(query, { uid: true })) || []) as number[];
      found.sort((a, b) => b - a);
      result.total = found.length;
      const slice = found.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (slice.length) msgs = await c.fetchAll(slice, SUMMARY_QUERY, { uid: true });
      msgs.sort((a, b) => b.uid - a.uid);
    } else {
      result.total = mb.exists;
      const end = mb.exists - page * PAGE_SIZE;
      if (end >= 1) {
        const start = Math.max(1, end - PAGE_SIZE + 1);
        msgs = await c.fetchAll(`${start}:${end}`, SUMMARY_QUERY);
        msgs.sort((a, b) => b.seq - a.seq);
      }
    }
    result.messages = await withSnippets(c, s.email, folder, msgs);
    return result;
  });
}

// ---------- single message ----------

type ParsedEntry = { at: number; parsed: ParsedMail; flags: Set<string>; threadId?: string; size: number };
const parsedCache = new Map<string, ParsedEntry>();

async function loadParsed(s: Session, folder: string, uid: number): Promise<ParsedEntry> {
  const k = `${s.email}|${folder}|${uid}`;
  const hit = parsedCache.get(k);
  if (hit && Date.now() - hit.at < 3 * 60_000) return hit;
  const entry = await withMailbox(s, folder, async (c) => {
    const meta = await c.fetchOne(String(uid), { uid: true, flags: true, threadId: true, size: true }, { uid: true });
    if (!meta) throw new HttpError(404, "errors.messageGone");
    if ((meta.size || 0) > MAX_SOURCE) throw new HttpError(413, "errors.messageTooBig");
    const dl = await c.download(String(uid), undefined, { uid: true, maxBytes: MAX_SOURCE });
    if (!dl.content) throw new HttpError(404, "errors.messageNotFound");
    const chunks: Buffer[] = [];
    for await (const ch of dl.content) chunks.push(ch as Buffer);
    const parsed = await simpleParser(Buffer.concat(chunks), { keepCidLinks: true, skipTextToHtml: true, skipImageLinks: true });
    return { at: Date.now(), parsed, flags: meta.flags || new Set<string>(), threadId: meta.threadId, size: meta.size || 0 };
  });
  // keep large messages out of memory: only those under 8 MB are cached
  const bytes = entry.parsed.attachments.reduce((n, a) => n + a.size, 0) + (entry.parsed.html ? String(entry.parsed.html).length : 0);
  if (bytes < 8 * 1024 * 1024) parsedCache.set(k, entry);
  if (parsedCache.size > 40) {
    const first = parsedCache.keys().next().value;
    if (first) parsedCache.delete(first);
  }
  return entry;
}

export function forgetParsed(email: string, folder: string, uid: number) {
  parsedCache.delete(`${email}|${folder}|${uid}`);
}

function attachmentList(p: ParsedMail, html: string): Attachment[] {
  return p.attachments.map((a, index) => {
    const cid = a.contentId?.replace(/^<|>$/g, "");
    const inline = !!cid && a.contentDisposition !== "attachment" && html.includes(`cid:${cid}`);
    return {
      index,
      filename: a.filename || (a.contentType === "message/rfc822" ? "message.eml" : `attachment-${index + 1}`),
      contentType: a.contentType,
      size: a.size,
      inline,
    };
  });
}

/** Parses List-Unsubscribe: <https://…>, <mailto:…> (RFC 2369) and one-click (RFC 8058). */
function parseUnsubscribe(p: ParsedMail): MessageFull["unsubscribe"] {
  // mailparser groups List-* headers under "list"; the raw line is more reliable (there may be several URLs)
  const line = (k: string) =>
    p.headerLines
      .filter((h) => h.key === k)
      .map((h) => h.line.replace(/^[^:]+:\s*/, "").replace(/\r?\n\s+/g, " "))
      .join(", ");
  const v = line("list-unsubscribe");
  if (!v) return undefined;
  const out: NonNullable<MessageFull["unsubscribe"]> = {};
  for (const m of v.matchAll(/<([^>]+)>/g)) {
    const u = m[1].trim();
    if (/^https:\/\//i.test(u) && !out.url) out.url = u;
    else if (/^mailto:/i.test(u) && !out.mailto) out.mailto = u;
  }
  if (!out.url && !out.mailto) return undefined;
  if (out.url && /one-click/i.test(line("list-unsubscribe-post"))) out.oneClick = true;
  return out;
}

/** Raw source (.eml download). */
export async function getRawSource(s: Session, folder: string, uid: number) {
  return withMailbox(s, folder, async (c) => {
    const meta = await c.fetchOne(String(uid), { uid: true, envelope: true, size: true }, { uid: true });
    if (!meta) throw new HttpError(404, "errors.messageNotFound");
    if ((meta.size || 0) > MAX_SOURCE) throw new HttpError(413, "errors.messageTooBigDownload");
    const dl = await c.download(String(uid), undefined, { uid: true, maxBytes: MAX_SOURCE });
    if (!dl.content) throw new HttpError(404, "errors.messageNotFound");
    const chunks: Buffer[] = [];
    for await (const ch of dl.content) chunks.push(ch as Buffer);
    return { subject: meta.envelope?.subject || "", content: Buffer.concat(chunks) };
  });
}

export async function readMessage(s: Session, folder: string, uid: number, allowRemote: boolean, markSeen: boolean): Promise<MessageFull> {
  const { parsed: p, flags, threadId, size } = await loadParsed(s, folder, uid);
  let seen = flags.has("\\Seen");
  if (markSeen && !seen) {
    await withMailbox(s, folder, (c) => c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }));
    flags.add("\\Seen");
    seen = true;
  }

  const rawHtml = typeof p.html === "string" ? p.html : "";
  const text = p.text || (rawHtml ? htmlToText(rawHtml) : "");
  const qs = `folder=${encodeURIComponent(folder)}&uid=${uid}`;
  const cids = new Map<string, number>();
  p.attachments.forEach((a, i) => a.contentId && cids.set(a.contentId.replace(/^<|>$/g, ""), i));

  let html: string;
  let blocked = 0;
  if (rawHtml) {
    const r = sanitizeEmail(rawHtml, {
      allowRemote,
      cidUrl: (cid) => (cids.has(cid) ? `/api/attachment?${qs}&index=${cids.get(cid)}&inline=1` : null),
    });
    html = r.html;
    blocked = r.blocked;
  } else {
    html = textToHtml(text);
  }

  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  return {
    folder,
    uid,
    threadId,
    messageId: p.messageId,
    references: refs,
    subject: p.subject || "",
    from: parsedAddrs(p.from),
    to: parsedAddrs(p.to),
    cc: parsedAddrs(p.cc),
    bcc: parsedAddrs(p.bcc),
    replyTo: parsedAddrs(p.replyTo),
    date: iso(p.date),
    seen,
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    draft: flags.has("\\Draft"),
    html,
    text,
    blockedImages: blocked,
    attachments: attachmentList(p, rawHtml),
    size,
    unsubscribe: parseUnsubscribe(p),
  };
}

export async function getAttachment(s: Session, folder: string, uid: number, index: number) {
  const { parsed } = await loadParsed(s, folder, uid);
  const a = parsed.attachments[index];
  if (!a) throw new HttpError(404, "errors.attachmentNotFound");
  return { filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType || "application/octet-stream", content: a.content };
}

// ---------- conversation ----------

export async function getThread(s: Session, folder: string, uid: number): Promise<ThreadItem[]> {
  const sp = await specialFolders(s);
  const own = await withMailbox(s, folder, async (c) => {
    const m = await c.fetchOne(String(uid), SUMMARY_QUERY, { uid: true });
    if (!m) throw new HttpError(404, "errors.messageNotFound");
    return (await withSnippets(c, s.email, folder, [m]))[0];
  });
  // Use THREADID when the server supports it, otherwise the Message-ID / References headers
  let query: SearchObject | null = own.threadId ? { threadId: own.threadId } : null;
  if (!query) {
    const { parsed } = await loadParsed(s, folder, uid).catch(() => ({ parsed: null as ParsedMail | null }));
    const refs = parsed ? (Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []) : [];
    const ids = [...new Set([...refs, parsed?.inReplyTo, own.messageId].filter(Boolean) as string[])].slice(-10);
    if (!ids.length) return [{ ...own, folder }];
    const ors: SearchObject[] = ids.map((id) => ({ header: { "message-id": id } }));
    if (own.messageId) ors.push({ header: { references: own.messageId } });
    query = ors.length === 1 ? ors[0] : { or: ors };
  }

  const folders = [...new Set([folder, sp.inbox, sp.sent, sp.archive].filter(Boolean) as string[])];
  const items: ThreadItem[] = [];
  for (const f of folders) {
    try {
      const got = await withMailbox(s, f, async (c) => {
        const uids = ((await c.search(query!, { uid: true })) || []) as number[];
        if (!uids.length) return [];
        const msgs = await c.fetchAll(uids.slice(-50), SUMMARY_QUERY, { uid: true });
        return withSnippets(c, s.email, f, msgs);
      });
      items.push(...got.map((m) => ({ ...m, folder: f })));
    } catch {}
  }
  // Show a message that lives in several folders (e.g. sent to yourself) once, preferring the open folder
  const seen = new Map<string, ThreadItem>();
  for (const it of items) {
    const k = it.messageId || `${it.folder}|${it.uid}`;
    const prev = seen.get(k);
    if (!prev || (it.folder === folder && prev.folder !== folder)) seen.set(k, it);
  }
  const out = [...seen.values()].filter((m) => !(m.draft && m.folder !== folder));
  if (!out.some((m) => m.folder === folder && m.uid === uid)) out.push({ ...own, folder });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- actions ----------

const range = (uids: UidSel) => (uids === "all" ? "1:*" : uids);
function forgetAll(s: Session, folder: string, uids: UidSel) {
  if (uids === "all") for (const k of [...parsedCache.keys()]) k.startsWith(`${s.email}|${folder}|`) && parsedCache.delete(k);
  else uids.forEach((u) => forgetParsed(s.email, folder, u));
}

export async function setFlags(s: Session, folder: string, uids: UidSel, flag: string, on: boolean) {
  await withMailbox(s, folder, async (c) => {
    if (uids === "all" && !(c.mailbox as MailboxObject).exists) return;
    return on ? c.messageFlagsAdd(range(uids), [flag], { uid: true }) : c.messageFlagsRemove(range(uids), [flag], { uid: true });
  });
}

export async function moveMessages(s: Session, folder: string, uids: UidSel, to: string) {
  if (folder === to) return { to, uids: [] as number[] };
  const r = await withMailbox(s, folder, async (c) => {
    if (uids === "all" && !(c.mailbox as MailboxObject).exists) return false;
    return c.messageMove(range(uids), to, { uid: true });
  });
  forgetAll(s, folder, uids);
  if (uids === "all") return { to, uids: [] as number[] }; // no undo for whole-folder moves
  const map = r && r.uidMap ? r.uidMap : new Map<number, number>();
  return { to, uids: uids.map((u) => map.get(u)).filter((x): x is number => !!x) };
}

/** Moves to Trash; deletes permanently when already in Trash/Junk. */
export async function deleteMessages(s: Session, folder: string, uids: UidSel) {
  const sp = await specialFolders(s);
  if (!sp.trash || folder === sp.trash || folder === sp.junk) {
    await withMailbox(s, folder, async (c) => {
      if (uids === "all" && !(c.mailbox as MailboxObject).exists) return;
      await c.messageDelete(range(uids), { uid: true });
    });
    forgetAll(s, folder, uids);
    return { permanent: true as const };
  }
  const moved = await moveMessages(s, folder, uids, sp.trash);
  return { permanent: false as const, ...moved };
}

// ---------- contacts (recipient suggestions) ----------

const contactCache = new Map<string, { at: number; list: Addr[] }>();

export async function getContacts(s: Session): Promise<Addr[]> {
  const hit = contactCache.get(s.email);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.list;
  const sp = await specialFolders(s);
  const score = new Map<string, { a: Addr; n: number }>();
  const add = (list: Addr[] | undefined, w: number) => {
    for (const a of list || []) {
      if (a.address === s.email || /no-?reply|mailer-daemon|notifications?@/i.test(a.address)) continue;
      const cur = score.get(a.address);
      if (cur) {
        cur.n += w;
        if (!cur.a.name && a.name) cur.a.name = a.name;
      } else score.set(a.address, { a: { ...a }, n: w });
    }
  };
  for (const [f, sent] of [[sp.sent, true], [sp.inbox, false]] as const) {
    if (!f) continue;
    try {
      await withMailbox(s, f, async (c) => {
        const mb = c.mailbox as MailboxObject;
        if (!mb.exists) return;
        const start = Math.max(1, mb.exists - 400);
        for await (const m of c.fetch(`${start}:*`, { envelope: true })) {
          if (sent) {
            add(addrs(m.envelope?.to), 3);
            add(addrs(m.envelope?.cc), 2);
          } else add(addrs(m.envelope?.from), 1);
        }
      });
    } catch {}
  }
  const list = [...score.values()].sort((a, b) => b.n - a.n).slice(0, 500).map((x) => x.a);
  contactCache.set(s.email, { at: Date.now(), list });
  return list;
}
