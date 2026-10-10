"use client";

import { escapeHtml, fmtAddr, longDate, stripPrefix } from "./client";
import type { Addr, MessageFull } from "./types";
import { t } from "@/i18n/client";

// Runs in the browser only (when a compose window opens), so the module-level translator is safe.

export type AttachRefUI = { folder: string; uid: number; index: number; filename: string; size: number };

export type ComposeInit = {
  key: number;
  mode: "new" | "reply" | "replyAll" | "forward" | "draft";
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string[];
  replyRef?: { folder: string; uid: number };
  attachRefs: AttachRefUI[];
  draftUid?: number;
  files?: File[]; // local attachments when an undone send is reopened
  restored?: boolean; // reopened after undo: content may be newer than the saved draft
};

let seq = 1;
export const nextKey = () => seq++;

function sigBlock(signature: string) {
  return signature ? `<div><br></div><div class="signature">-- <br>${signature}</div>` : "";
}

function addrLine(list: Addr[]) {
  return list.map((a) => escapeHtml(fmtAddr(a))).join(", ");
}

function quoteBody(m: MessageFull) {
  // Quote the plain text instead of reusing the HTML outside the sandbox: safe and clean
  const text = escapeHtml(m.text || "").replace(/\r?\n/g, "<br>");
  return text;
}

export function newCompose(signature: string, to: Addr[] = []): ComposeInit {
  return { key: nextKey(), mode: "new", to, cc: [], bcc: [], subject: "", html: `<div><br></div>${sigBlock(signature)}`, attachRefs: [] };
}

export function replyCompose(m: MessageFull, mode: "reply" | "replyAll", me: string, signature: string): ComposeInit {
  const mine = (a: Addr) => a.address === me;
  const fromMe = m.from.some(mine);
  let to: Addr[];
  let cc: Addr[] = [];
  if (fromMe) {
    // replying to our own message: same recipients
    to = m.to;
    if (mode === "replyAll") cc = m.cc;
  } else {
    to = m.replyTo.length ? m.replyTo : m.from;
    if (mode === "replyAll") {
      const seen = new Set(to.map((a) => a.address));
      cc = [...m.to, ...m.cc].filter((a) => !mine(a) && !seen.has(a.address) && (seen.add(a.address), true));
    }
  }
  const subj = stripPrefix(m.subject);
  const who = m.from[0] ? escapeHtml(fmtAddr(m.from[0])) : "";
  const html =
    `<div><br></div>${sigBlock(signature)}<div><br></div>` +
    `<div class="mw-attr">${escapeHtml(t("compose.wrote", { date: longDate(m.date), sender: "\u0000" })).replace("\u0000", who)}</div>` +
    `<blockquote type="cite" class="mw-quote" style="margin:0 0 0 .8ex;border-left:2px solid #d0d0d6;padding-left:1ex;color:#555">${quoteBody(m)}</blockquote>`;
  return {
    key: nextKey(),
    mode,
    to,
    cc,
    bcc: [],
    subject: subj ? `${t("compose.replyPrefix")} ${subj}` : t("compose.replyPrefix"),
    html,
    inReplyTo: m.messageId,
    references: [...m.references, ...(m.messageId ? [m.messageId] : [])].slice(-20),
    replyRef: { folder: m.folder, uid: m.uid },
    attachRefs: [],
  };
}

export function forwardCompose(m: MessageFull, signature: string): ComposeInit {
  const subj = stripPrefix(m.subject);
  const head = [
    `<b>${t("common.from")}:</b> ${addrLine(m.from)}`,
    `<b>${t("common.date")}:</b> ${escapeHtml(longDate(m.date))}`,
    `<b>${t("common.subject")}:</b> ${escapeHtml(m.subject)}`,
    `<b>${t("common.to")}:</b> ${addrLine(m.to)}`,
    m.cc.length ? `<b>${t("common.cc")}:</b> ${addrLine(m.cc)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  const html =
    `<div><br></div>${sigBlock(signature)}<div><br></div>` +
    `<div class="mw-fwd">${escapeHtml(t("compose.forwarded"))}<br>${head}<br><br>${quoteBody(m)}</div>`;
  return {
    key: nextKey(),
    mode: "forward",
    to: [],
    cc: [],
    bcc: [],
    subject: subj ? `${t("compose.forwardPrefix")} ${subj}` : t("compose.forwardPrefix"),
    html,
    references: m.messageId ? [...m.references, m.messageId].slice(-20) : m.references,
    attachRefs: m.attachments.filter((a) => !a.inline).map((a) => ({ folder: m.folder, uid: m.uid, index: a.index, filename: a.filename, size: a.size })),
  };
}

export function draftCompose(m: MessageFull, rawHtml: string): ComposeInit {
  return {
    key: nextKey(),
    mode: "draft",
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    html: rawHtml,
    inReplyTo: undefined,
    references: m.references,
    attachRefs: m.attachments.map((a) => ({ folder: m.folder, uid: m.uid, index: a.index, filename: a.filename, size: a.size })),
    draftUid: m.uid,
  };
}
