import "server-only";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import { env } from "./env";
import { HttpError } from "./api";
import { getClient, specialFolders, withMailbox } from "./imap";
import { getAttachment } from "./mail";
import { htmlToText, sanitizeOutgoing } from "./sanitize";
import { redis } from "./redis";
import type { Session } from "./session";
import type { MessageKey } from "@/i18n/format";
import { UNDO_CHOICES, type Addr, type Settings } from "./types";

export const MAX_TOTAL_ATTACH = 25 * 1024 * 1024;

export type AttachRef = { folder: string; uid: number; index: number };

export type Draft = {
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string[];
  replyRef?: { folder: string; uid: number }; // the message being replied to (for the \Answered flag)
  attachRefs: AttachRef[]; // attachments carried over from a forward/draft
  files: { filename: string; contentType: string; content: Buffer }[];
};

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function cleanAddrs(v: unknown): Addr[] {
  if (!Array.isArray(v)) return [];
  if (v.length > 100) throw new HttpError(400, "errors.tooManyRecipients");
  return v.map((x) => {
    const a = x as Addr;
    const address = String(a?.address || "").trim().toLowerCase();
    if (!EMAIL_RE.test(address)) throw new HttpError(400, "errors.badAddress", { address: address || "—" });
    const name = typeof a.name === "string" ? a.name.replace(/[\r\n"]/g, "").slice(0, 200) : undefined;
    return { address, name: name || undefined };
  });
}

// ---------- settings ----------

export async function getSettings(s: Session): Promise<Settings> {
  const raw = await redis.get(`cfg:${s.email}`);
  const def: Settings = { name: defaultName(s.email), signature: "", loadImages: false, undoSeconds: 10 };
  if (!raw) return def;
  try {
    return { ...def, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return def;
  }
}

export async function saveSettings(s: Session, v: Partial<Settings>) {
  const cur = await getSettings(s);
  const next: Settings = {
    name: typeof v.name === "string" ? v.name.replace(/[\r\n"<>]/g, "").trim().slice(0, 120) || cur.name : cur.name,
    signature: typeof v.signature === "string" ? sanitizeOutgoing(v.signature.slice(0, 20_000)) : cur.signature,
    loadImages: typeof v.loadImages === "boolean" ? v.loadImages : cur.loadImages,
    undoSeconds: typeof v.undoSeconds === "number" && UNDO_CHOICES.includes(v.undoSeconds) ? v.undoSeconds : cur.undoSeconds,
  };
  await redis.set(`cfg:${s.email}`, JSON.stringify(next));
  return next;
}

function defaultName(email: string) {
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  return local.replace(/\b\p{L}/gu, (c) => c.toLocaleUpperCase());
}

// ---------- MIME building ----------

async function build(s: Session, d: Draft, opts: { draft: boolean }) {
  const settings = await getSettings(s);
  const domain = s.email.split("@")[1] || "localhost";
  const messageId = `<${crypto.randomUUID()}@${domain}>`;

  const attachments: Mail.Attachment[] = [];
  let total = 0;
  for (const r of d.attachRefs) {
    const a = await getAttachment(s, r.folder, r.uid, r.index);
    total += a.content.length;
    attachments.push({ filename: a.filename, contentType: a.contentType, content: a.content });
  }
  for (const f of d.files) {
    total += f.content.length;
    attachments.push({ filename: f.filename, contentType: f.contentType, content: f.content });
  }
  if (total > MAX_TOTAL_ATTACH) throw new HttpError(413, "errors.attachmentsTooBig");

  const html = sanitizeOutgoing(d.html);
  const doc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">${html}</body></html>`;

  const mail: Mail.Options = {
    from: { name: settings.name, address: s.email },
    to: d.to,
    cc: d.cc.length ? d.cc : undefined,
    bcc: d.bcc.length ? d.bcc : undefined,
    subject: d.subject,
    html: doc,
    text: htmlToText(html),
    messageId,
    date: new Date(),
    inReplyTo: d.inReplyTo,
    references: d.references?.length ? d.references.join(" ") : undefined,
    attachments,
    headers: { "X-Mailer": "Mailwick" },
  };
  const composer = new MailComposer(mail);
  // Drafts must keep the Bcc header; when sending, nodemailer takes it from the envelope and strips it
  const node = composer.compile();
  if (opts.draft) node.keepBcc = true;
  const raw = await node.build();
  return { raw, messageId };
}

function transport(s: Session) {
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    requireTLS: !env.smtpSecure,
    auth: { user: s.email, pass: s.password },
    tls: { rejectUnauthorized: !env.tlsInsecure },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
}

export async function sendDraft(s: Session, d: Draft, draftUid?: number) {
  if (!d.to.length && !d.cc.length && !d.bcc.length) throw new HttpError(400, "errors.noRecipients");
  const { raw, messageId } = await build(s, d, { draft: false });
  const t = transport(s);
  try {
    await t.sendMail({
      envelope: { from: s.email, to: [...d.to, ...d.cc, ...d.bcc].map((a) => a.address) },
      raw,
    });
  } catch (e) {
    const err = e as { responseCode?: number; response?: string; code?: string };
    console.error("[mail] smtp", err.code, err.responseCode, err.response);
    if (err.code === "EAUTH") throw new HttpError(401, "errors.smtpAuth");
    throw err.response ? new HttpError(502, "errors.sendFailedReason", { reason: err.response }) : new HttpError(502, "errors.sendFailed");
  } finally {
    t.close();
  }

  // Sent; everything below is best effort (the mail is already on its way)
  const sp = await specialFolders(s);
  const warnings: MessageKey[] = [];
  if (sp.sent) {
    try {
      const c = await getClient(s);
      await c.append(sp.sent, raw, ["\\Seen"]);
    } catch {
      warnings.push("errors.sentNotSaved");
    }
  }
  if (d.replyRef) {
    try {
      await withMailbox(s, d.replyRef.folder, (c) => c.messageFlagsAdd(String(d.replyRef!.uid), ["\\Answered"], { uid: true }));
    } catch {}
  }
  if (draftUid && sp.drafts) {
    try {
      await withMailbox(s, sp.drafts, (c) => c.messageDelete(String(draftUid), { uid: true }));
    } catch {}
  }
  return { messageId, warnings };
}

export async function saveDraft(s: Session, d: Draft, prevUid?: number) {
  const sp = await specialFolders(s);
  if (!sp.drafts) throw new HttpError(400, "errors.noDraftsFolder");
  const { raw } = await build(s, d, { draft: true });
  const c = await getClient(s);
  const r = await c.append(sp.drafts, raw, ["\\Draft", "\\Seen"]);
  if (prevUid) {
    try {
      await withMailbox(s, sp.drafts, (cc) => cc.messageDelete(String(prevUid), { uid: true }));
    } catch {}
  }
  return { uid: r ? r.uid : undefined, folder: sp.drafts };
}

export async function discardDraft(s: Session, uid: number) {
  const sp = await specialFolders(s);
  if (!sp.drafts) return;
  await withMailbox(s, sp.drafts, (c) => c.messageDelete(String(uid), { uid: true }));
}
