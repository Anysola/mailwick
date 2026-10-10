"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, displayName, escapeHtml, fileSize, fmtAddr, longDate, mediumDate, relative, shortDate } from "@/lib/client";
import { confirmDialog } from "@/lib/dialog-service";
import type { Addr, Attachment, MessageFull, ThreadItem } from "@/lib/types";
import { Avatar, Button, cx, Icon, IconButton, MenuDivider, MenuItem, Popover, Spinner } from "./ui";
import { MailFrame } from "./MailFrame";
import { t as translate, useLocale, useT } from "@/i18n/client";

export type ReaderActions = {
  reply: (m: MessageFull, mode: "reply" | "replyAll") => void;
  forward: (m: MessageFull) => void;
  remove: () => void;
  archive?: () => void;
  spam?: () => void;
  notSpam?: () => void;
  move: (anchor: HTMLElement) => void;
  markUnread: () => void;
  star: (on: boolean) => void;
  close: () => void;
  prev?: () => void;
  next?: () => void;
  mailto: (address: string, subject?: string) => void;
  onSeen: (folder: string, uid: number) => void;
};

// Opened messages stay in memory for the session (instant when reopened)
const fullCache = new Map<string, MessageFull>();
export const forgetFull = (folder: string, uid: number) => fullCache.delete(`${folder}|${uid}`);

// "Always show images from this sender" list (per browser)
const TRUST_KEY = "mw-img-senders";
function trustedSenders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TRUST_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function trustSender(address: string) {
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify([...new Set([...trustedSenders(), address.toLowerCase()])].slice(-500)));
  } catch {}
}

/** Print: headers + sanitized body in a separate window, then the browser print dialog. */
function printMessage(m: MessageFull, subject: string, locale: string) {
  const t = translate;
  const w = window.open("", "_blank", "width=900,height=720");
  if (!w) return;
  const rows = (
    [
      [t("common.from"), m.from],
      [t("common.to"), m.to],
      [t("common.cc"), m.cc],
    ] as [string, Addr[]][]
  )
    .filter(([, v]) => v.length)
    .map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v.map(fmtAddr).join(", "))}</td></tr>`)
    .join("");
  const att = m.attachments.filter((a) => !a.inline);
  const doc = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(subject || t("common.noSubject"))}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>body{font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;margin:32px;max-width:860px}
h1{font-size:20px;margin:0 0 12px}table.h{border-collapse:collapse;margin-bottom:20px;font-size:13px}table.h th{text-align:start;color:#666;font-weight:600;padding-block:2px;padding-inline:0 14px;vertical-align:top;white-space:nowrap}table.h td{padding:2px 0}
.body{border-top:1px solid #ddd;padding-top:18px}.plain{white-space:pre-wrap}.plain .q{color:#777}img{max-width:100%;height:auto}blockquote{margin-block:.5em;margin-inline:.4em 0;padding-inline-start:.9em;border-inline-start:3px solid #ccc}
.att{margin-top:22px;border-top:1px solid #ddd;padding-top:10px;font-size:13px;color:#555}@media print{body{margin:0}}</style></head><body>
<h1>${escapeHtml(subject || t("common.noSubject"))}</h1>
<table class="h">${rows}<tr><th>${t("common.date")}</th><td>${escapeHtml(longDate(m.date))}</td></tr></table>
<div class="body" dir="auto">${m.html}</div>
${att.length ? `<div class="att">${escapeHtml(t("reader.attachmentsPrint", { list: att.map((a) => `${a.filename} (${fileSize(a.size)})`).join(", ") }))}</div>` : ""}
<script>setTimeout(function(){window.print()},350)</script></body></html>`;
  w.document.open();
  w.document.write(doc);
  w.document.close();
}

export function Reader({
  folder,
  uid,
  dark,
  flagged,
  actions,
  registerLatest,
  me,
  isJunk,
}: {
  folder: string;
  uid: number;
  dark: boolean;
  flagged: boolean;
  actions: ReaderActions;
  registerLatest: (m: MessageFull | null) => void;
  me: string;
  isJunk: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, MessageFull>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let off = false;
    setItems(null);
    setError("");
    setLoaded({});
    registerLatest(null);
    api<{ items: ThreadItem[] }>(`/api/thread?folder=${encodeURIComponent(folder)}&uid=${uid}`)
      .then((r) => {
        if (off) return;
        setItems(r.items);
        const ex = new Set<string>();
        r.items.forEach((it, i) => {
          if (i === r.items.length - 1 || !it.seen || (it.folder === folder && it.uid === uid)) ex.add(`${it.folder}|${it.uid}`);
        });
        setExpanded(ex);
      })
      .catch((e) => !off && setError(e.message));
    scrollRef.current?.scrollTo({ top: 0 });
    return () => {
      off = true;
    };
  }, [folder, uid, registerLatest]);

  const onLoaded = useCallback((m: MessageFull) => {
    setLoaded((l) => ({ ...l, [`${m.folder}|${m.uid}`]: m }));
  }, []);

  // report the latest opened message in the thread for the r/a/f shortcuts
  useEffect(() => {
    if (!items) return;
    for (let i = items.length - 1; i >= 0; i--) {
      const k = `${items[i].folder}|${items[i].uid}`;
      if (loaded[k] && !items[i].draft) {
        registerLatest(loaded[k]);
        return;
      }
    }
  }, [items, loaded, registerLatest]);

  const latest = useMemo(() => {
    if (!items) return null;
    for (let i = items.length - 1; i >= 0; i--) {
      const m = loaded[`${items[i].folder}|${items[i].uid}`];
      if (m && !m.draft) return m;
    }
    return null;
  }, [items, loaded]);

  const subject = items?.find((i) => i.folder === folder && i.uid === uid)?.subject ?? items?.[0]?.subject ?? "";
  const moveRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="m3-axis-x flex h-full min-w-0 flex-col bg-panel lg:animate-none">
      {/* toolbar: switches to the M3 "scrolled" color when the content scrolls */}
      <header
        className={cx(
          "flex h-16 shrink-0 items-center gap-0.5 px-2 transition-colors duration-200 ease-std md:px-3",
          scrolled && "bg-panel-2 dark:bg-surface-high",
        )}
      >
        <IconButton label={t("common.back")} onClick={actions.close} className="lg:hidden">
          <Icon name="arrow_back" />
        </IconButton>
        {actions.archive && (
          <IconButton label={t("reader.archive")} onClick={actions.archive}><Icon name="archive" /></IconButton>
        )}
        {actions.spam && (
          <IconButton label={t("reader.spam")} onClick={actions.spam}><Icon name="report" /></IconButton>
        )}
        {actions.notSpam && (
          <IconButton label={t("reader.notSpam")} onClick={actions.notSpam}><Icon name="report_off" /></IconButton>
        )}
        <IconButton label={t("reader.delete")} onClick={actions.remove} className="hover:!text-danger"><Icon name="delete" /></IconButton>
        <IconButton ref={moveRef} label={t("reader.move")} onClick={() => moveRef.current && actions.move(moveRef.current)}><Icon name="drive_file_move" size={20} /></IconButton>
        <IconButton label={t("reader.markUnread")} onClick={actions.markUnread}><Icon name="mark_email_unread" /></IconButton>
        <IconButton label={flagged ? t("reader.unstar") : t("reader.star")} selected={flagged} onClick={() => actions.star(!flagged)} className={flagged ? "!text-star" : ""}>
          <Icon name="star" fill={flagged} />
        </IconButton>
        <div className="flex-1" />
        <IconButton label={t("reader.prev")} onClick={actions.prev} disabled={!actions.prev}><Icon name="keyboard_arrow_up" /></IconButton>
        <IconButton label={t("reader.next")} onClick={actions.next} disabled={!actions.next}><Icon name="keyboard_arrow_down" /></IconButton>
      </header>

      <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)} className="flex-1 overflow-y-auto">
        {error ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <div className="text-[14px] font-medium">{t("reader.openFailed")}</div>
              <div className="mt-1 text-[13px] text-muted">{error}</div>
            </div>
          </div>
        ) : !items ? (
          <ReaderSkeleton />
        ) : (
          <div className="mx-auto max-w-[940px] px-4 pb-6 pt-2 sm:px-8">
            {isJunk && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-danger-soft py-1 ps-4 pe-1 type-body-medium text-on-danger-soft">
                <Icon name="report" size={20} />
                <span className="flex-1 py-2">{t("reader.junkWarning")}</span>
                {actions.notSpam && (
                  <Button variant="text" className="!text-on-danger-soft" onClick={actions.notSpam}>{t("reader.notJunk")}</Button>
                )}
              </div>
            )}
            <h1 dir="auto" className="text-left rtl:text-right type-headline-small text-fg [overflow-wrap:anywhere]">
              {subject || <span className="italic text-muted">{t("common.noSubject")}</span>}
            </h1>
            {items.length > 1 && <div className="mt-1 text-[13px] text-muted">{t("common.messages", { count: items.length })}</div>}

            <div className="mt-5 space-y-1">
              {items.map((it) => {
                const k = `${it.folder}|${it.uid}`;
                return (
                  <MessageCard
                    key={k}
                    item={it}
                    expanded={expanded.has(k)}
                    onToggle={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                    dark={dark}
                    actions={actions}
                    onLoaded={onLoaded}
                    me={me}
                    single={items.length === 1}
                  />
                );
              })}
            </div>

            {latest && (
              <div className="mt-6 flex flex-wrap gap-3 pb-8 sm:ps-[54px]">
                <Button variant="filled" icon="reply" onClick={() => actions.reply(latest, "reply")}>{t("reader.reply")}</Button>
                {latest.to.length + latest.cc.length > 1 && (
                  <Button variant="outlined" icon="reply_all" onClick={() => actions.reply(latest, "replyAll")}>{t("reader.replyAll")}</Button>
                )}
                <Button variant="outlined" icon="forward" onClick={() => actions.forward(latest)}>{t("reader.forward")}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function MessageCard({
  item,
  expanded,
  onToggle,
  dark,
  actions,
  onLoaded,
  me,
  single,
}: {
  item: ThreadItem;
  expanded: boolean;
  onToggle: () => void;
  dark: boolean;
  actions: ReaderActions;
  onLoaded: (m: MessageFull) => void;
  me: string;
  single: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const key = `${item.folder}|${item.uid}`;
  const [msg, setMsg] = useState<MessageFull | null>(() => fullCache.get(key) || null);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (images = false) => {
      try {
        const trusted = images || trustedSenders().includes((item.from[0]?.address || "").toLowerCase());
        const m = await api<MessageFull>(`/api/message?folder=${encodeURIComponent(item.folder)}&uid=${item.uid}${trusted ? "&images=1" : ""}`);
        fullCache.set(key, m);
        setMsg(m);
        onLoaded(m);
        if (!item.seen) actions.onSeen(item.folder, item.uid);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (!expanded) return;
    const cached = fullCache.get(key);
    if (cached) {
      setMsg(cached);
      onLoaded(cached);
    } else load();
  }, [expanded, key, load, onLoaded]);

  const from = item.from[0];
  const isMe = from?.address === me;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="sl flex w-full items-center gap-3.5 rounded-2xl px-0 py-3 text-left text-fg sm:-mx-3 sm:w-[calc(100%+24px)] sm:px-3"
      >
        <Avatar addr={from} size={40} />
        <span className={cx("w-[160px] shrink-0 truncate text-[14px]", item.seen ? "font-medium text-fg-2" : "font-bold")}>
          {isMe ? t("common.me") : displayName(from)}
        </span>
        <span dir="auto" className="min-w-0 flex-1 truncate text-left rtl:text-right text-[14px] text-muted">{item.snippet}</span>
        {item.attachments && <Icon name="attach_file" size={14} className="shrink-0 text-muted" />}
        <span className="shrink-0 text-[12px] text-muted tabular-nums">{shortDate(item.date)}</span>
      </button>
    );
  }

  const rel = relative(item.date);
  const plain = !!msg && msg.html.startsWith('<div class="plain">');
  const visibleAtt = msg?.attachments.filter((a) => !a.inline) || [];

  return (
    <article className={cx(!single && "border-y border-line-2 py-1")}>
      <div className="flex items-start gap-3.5 pt-3">
        <Avatar addr={from} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button type="button" onClick={single ? undefined : onToggle} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span dir="auto" className="type-title-medium text-fg">{displayName(from)}</span>
                {from?.name && <span className="truncate type-body-medium text-muted">{from.address}</span>}
              </div>
            </button>
            <span className="shrink-0 pt-0.5 type-body-small text-muted tabular-nums" data-tip={longDate(item.date)}>
              {mediumDate(item.date)}
              {rel && <span className="hidden sm:inline"> ({rel})</span>}
            </span>
            {msg && (
              <div className="-me-2 -mt-2 flex shrink-0 items-center">
                <IconButton label={t("reader.reply")} onClick={() => actions.reply(msg, "reply")}><Icon name="reply" size={20} /></IconButton>
                <IconButton ref={moreRef} label={t("reader.more")} onClick={() => setMore((v) => !v)}><Icon name="more_vert" size={20} /></IconButton>
                <Popover anchor={moreRef} open={more} onClose={() => setMore(false)} align="end" className="w-[240px]">
                  <MenuItem icon={<Icon name="reply" />} hint="R" onClick={() => { setMore(false); actions.reply(msg, "reply"); }}>{t("reader.reply")}</MenuItem>
                  <MenuItem icon={<Icon name="reply_all" />} hint="A" onClick={() => { setMore(false); actions.reply(msg, "replyAll"); }}>{t("reader.replyAll")}</MenuItem>
                  <MenuItem icon={<Icon name="forward" />} hint="F" onClick={() => { setMore(false); actions.forward(msg); }}>{t("reader.forward")}</MenuItem>
                  <MenuDivider />
                  {msg.unsubscribe && (
                    <MenuItem icon={<Icon name="unsubscribe" />} onClick={() => { setMore(false); unsubscribe(msg, actions); }}>{t("reader.unsubscribe")}</MenuItem>
                  )}
                  <MenuItem icon={<Icon name="print" />} onClick={() => { setMore(false); printMessage(msg, msg.subject, locale); }}>{t("reader.print")}</MenuItem>
                  <MenuItem icon={<Icon name="download" />} onClick={() => { setMore(false); window.location.href = `/api/raw?folder=${encodeURIComponent(msg.folder)}&uid=${msg.uid}`; }}>{t("reader.download")}</MenuItem>
                </Popover>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-0.5 flex max-w-full items-center gap-1 rounded text-left type-body-medium text-muted hover:text-fg"
          >
            <span className="truncate">
              {t("reader.toLine", { names: (msg?.to || item.to).map((a) => (a.address === me ? t("reader.toMe") : displayName(a))).join(", ") || "—" })}
              {msg && msg.cc.length > 0 && t("reader.ccLine", { names: msg.cc.map((a) => displayName(a)).join(", ") })}
            </span>
            <Icon name="expand_more" size={18} className={cx("transition-transform duration-200 ease-std", showDetails && "rotate-180")} />
          </button>
          {showDetails && msg && (
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-panel-2 p-4 text-[13px] animate-fade">
              <Detail k={t("common.from")} v={msg.from} />
              {msg.replyTo.length > 0 && <Detail k={t("common.replyTo")} v={msg.replyTo} />}
              <Detail k={t("common.to")} v={msg.to} />
              {msg.cc.length > 0 && <Detail k={t("common.cc")} v={msg.cc} />}
              {msg.bcc.length > 0 && <Detail k={t("common.bcc")} v={msg.bcc} />}
              <span className="text-muted">{t("common.date")}</span>
              <span className="text-fg-2">{longDate(msg.date)}</span>
              <span className="text-muted">{t("common.subject")}</span>
              <span className="text-fg-2 [overflow-wrap:anywhere]">{msg.subject}</span>
              {msg.size > 0 && (
                <>
                  <span className="text-muted">{t("common.size")}</span>
                  <span className="text-fg-2">{fileSize(msg.size)}</span>
                </>
              )}
            </div>
          )}
          {msg?.unsubscribe && (
            <button
              type="button"
              onClick={() => unsubscribe(msg, actions)}
              className="sl mt-1 inline-flex h-7 items-center gap-1 rounded-full border border-faint px-2.5 type-label-medium text-muted hover:text-fg"
            >
              <Icon name="unsubscribe" size={16} /> {t("reader.unsubscribe")}
            </button>
          )}
        </div>
      </div>

      <div className="pb-5 pt-4 sm:ps-[54px]">
        {error ? (
          <div className="text-[13px] text-danger">{error}</div>
        ) : !msg ? (
          <div className="space-y-2.5 py-2">
            <div className="skeleton h-3 w-11/12" />
            <div className="skeleton h-3 w-4/5" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        ) : (
          <>
            {msg.blockedImages > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-panel-2 py-1 ps-4 pe-1 type-body-medium text-muted dark:bg-surface-high">
                <Icon name="hide_image" size={20} />
                <span className="flex-1 py-2">{t("reader.imagesBlocked")}</span>
                <Button
                  variant="text"
                  loading={loadingImages}
                  onClick={async () => {
                    setLoadingImages(true);
                    await load(true);
                    setLoadingImages(false);
                  }}
                >
                  {t("reader.showImages")}
                </Button>
                {from?.address && (
                  <Button
                    variant="text"
                    className="!text-muted"
                    onClick={async () => {
                      trustSender(from.address);
                      setLoadingImages(true);
                      await load(true);
                      setLoadingImages(false);
                    }}
                  >
                    {t("reader.alwaysShow")}
                  </Button>
                )}
              </div>
            )}
            <div className={cx(!plain && "rounded-2xl bg-white", !plain && dark && "p-4")}>
              <MailFrame html={msg.html} images={msg.blockedImages === 0} plain={plain} dark={dark} onMailto={actions.mailto} />
            </div>
            {visibleAtt.length > 0 && <Attachments msg={msg} list={visibleAtt} />}
          </>
        )}
      </div>
    </article>
  );
}

/** List-Unsubscribe: open the https link in a new tab (after confirming), else compose to the mailto address. */
async function unsubscribe(m: MessageFull, actions: ReaderActions) {
  const u = m.unsubscribe;
  if (!u) return;
  const t = translate;
  const who = m.from[0] ? displayName(m.from[0]) : t("reader.thisSender");
  if (u.url) {
    let host = "";
    try {
      host = new URL(u.url).host;
    } catch {}
    const ok = await confirmDialog({
      title: t("reader.unsubscribeTitle"),
      text: t("reader.unsubscribeText", { host: host || t("reader.theSender"), sender: who }),
      confirm: t("common.open"),
      icon: "unsubscribe",
    });
    if (ok) window.open(u.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (u.mailto) {
    try {
      const url = new URL(u.mailto);
      actions.mailto(decodeURIComponent(url.pathname), url.searchParams.get("subject") || "unsubscribe");
    } catch {}
  }
}

function Detail({ k, v }: { k: string; v: Addr[] }) {
  return (
    <>
      <span className="text-muted">{k}</span>
      <span className="text-fg-2 [overflow-wrap:anywhere]">{v.map(fmtAddr).join(", ")}</span>
    </>
  );
}

function fileIcon(a: Attachment) {
  const t = a.contentType;
  if (t.startsWith("image/")) return <Icon name="image" />;
  if (t === "application/pdf" || t.startsWith("text/")) return <Icon name="description" />;
  if (/zip|rar|7z|tar|gzip/.test(t)) return <Icon name="folder_zip" />;
  if (/sheet|excel|csv/.test(t)) return <Icon name="table_view" />;
  if (t.startsWith("audio/")) return <Icon name="audio_file" />;
  if (t.startsWith("video/")) return <Icon name="video_file" />;
  return <Icon name="draft" />;
}

const PREVIEW = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain)$/i;

function Attachments({ msg, list }: { msg: MessageFull; list: Attachment[] }) {
  const t = useT();
  const base = `/api/attachment?folder=${encodeURIComponent(msg.folder)}&uid=${msg.uid}`;
  const total = list.reduce((s, a) => s + a.size, 0);
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 type-title-small text-muted">
        <Icon name="attach_file" size={20} />
        {t("reader.attachments", { count: list.length, size: fileSize(total) })}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {list.map((a) => {
          const isImg = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(a.contentType);
          const href = PREVIEW.test(a.contentType) ? `${base}&index=${a.index}&inline=1` : `${base}&index=${a.index}`;
          return (
            <div key={a.index} className="group relative flex items-center gap-3 rounded-xl border border-line p-2.5 pe-1.5">
              <a href={href} target="_blank" rel="noopener" className="sl absolute inset-0 rounded-xl text-fg" aria-label={t("reader.openFile", { name: a.filename })} />
              {isImg ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${base}&index=${a.index}&inline=1`} alt="" className="pointer-events-none relative h-10 w-10 shrink-0 rounded-lg object-cover bg-hover" loading="lazy" />
              ) : (
                <div className="pointer-events-none relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-select text-on-select">{fileIcon(a)}</div>
              )}
              <div className="pointer-events-none relative min-w-0 flex-1">
                <div className="truncate type-title-small text-fg">{a.filename}</div>
                <div className="type-body-small text-muted">{fileSize(a.size)}</div>
              </div>
              <a
                href={`${base}&index=${a.index}`}
                download={a.filename}
                className="sl relative z-10 grid h-10 w-10 place-items-center rounded-full text-muted transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                data-tip={t("reader.downloadShort")}
                aria-label={t("reader.downloadFile", { name: a.filename })}
              >
                <Icon name="download" size={20} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto max-w-[940px] px-4 pt-2 sm:px-8">
      <div className="skeleton h-7 w-2/3" />
      <div className="mt-6">
        <div className="flex gap-3">
          <div className="skeleton h-10 w-10 !rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-3.5 w-1/4" />
            <div className="skeleton h-3 w-1/3" />
          </div>
        </div>
        <div className="mt-6 space-y-2.5 ps-[54px]">
          <div className="skeleton h-3 w-11/12" />
          <div className="skeleton h-3 w-4/5" />
          <div className="skeleton h-3 w-5/6" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

export function ReaderEmpty({ count }: { count: number }) {
  const t = useT();
  return (
    <section className="hidden h-full flex-col items-center justify-center bg-panel text-center lg:flex">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-accent-soft text-on-accent-soft">
        <Icon name="mail" size={40} />
      </div>
      <div className="mt-5 text-[16px] font-medium">{count > 0 ? t("reader.pickMessage") : t("reader.nothingHere")}</div>
      <div className="mt-4 flex items-center gap-4 text-[13px] text-muted">
        <span className="flex items-center gap-1.5"><kbd className="kbd">J</kbd><kbd className="kbd">K</kbd> {t("reader.hintNavigate")}</span>
        <span className="flex items-center gap-1.5"><kbd className="kbd">C</kbd> {t("reader.hintCompose")}</span>
        <span className="flex items-center gap-1.5"><kbd className="kbd">?</kbd> {t("reader.hintShortcuts")}</span>
      </div>
    </section>
  );
}

export { Spinner };
