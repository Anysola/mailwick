"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayName, fileSize, isMac } from "@/lib/client";
import { nextKey, type ComposeInit } from "@/lib/compose-client";
import type { Addr } from "@/lib/types";
import { Avatar, Button, cx, Icon, IconButton, Spinner } from "./ui";
import { confirmDialog, promptDialog } from "@/lib/dialog-service";
import { useLocale, useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/format";

const MAX_TOTAL = 25 * 1024 * 1024;
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

type Props = {
  init: ComposeInit;
  contacts: Addr[];
  onClose: () => void;
  /** Hands the send to the parent (which runs the undo delay); `restore` reopens this window as it was. */
  onQueue: (body: FormData, restore: ComposeInit) => void;
  onError: (msg: string) => void;
  onDraftSaved: () => void;
  onDiscarded: () => void;
};

type LocalFile = { id: number; file: File };

function parseAddr(raw: string): Addr | null {
  const s = raw.trim().replace(/[,;]+$/, "");
  if (!s) return null;
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (m ? m[2] : s).trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  const name = m?.[1]?.trim();
  return { address, name: name || undefined };
}

const FORMAT: [string, string, MessageKey][] = [
  ["bold", "format_bold", "composer.bold"],
  ["italic", "format_italic", "composer.italic"],
  ["underline", "format_underlined", "composer.underline"],
  ["strikeThrough", "strikethrough_s", "composer.strike"],
  ["insertUnorderedList", "format_list_bulleted", "composer.bullets"],
  ["insertOrderedList", "format_list_numbered", "composer.numbers"],
  ["blockquote", "format_quote", "composer.quote"],
];

export function Composer({ init, contacts, onClose, onQueue, onError, onDraftSaved, onDiscarded }: Props) {
  const t = useT();
  const [to, setTo] = useState<Addr[]>(init.to);
  const [cc, setCc] = useState<Addr[]>(init.cc);
  const [bcc, setBcc] = useState<Addr[]>(init.bcc);
  const [showCc, setShowCc] = useState(init.cc.length > 0);
  const [showBcc, setShowBcc] = useState(init.bcc.length > 0);
  const [subject, setSubject] = useState(init.subject);
  const [refs, setRefs] = useState(init.attachRefs);
  const [files, setFiles] = useState<LocalFile[]>(() => (init.files || []).map((file, i) => ({ id: i + 1, file })));
  const [mode, setMode] = useState<"normal" | "min" | "max">("normal");
  const [draftUid, setDraftUid] = useState<number | undefined>(init.draftUid);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "error">(init.draftUid ? "saved" : "idle");
  const [dirty, setDirty] = useState(init.restored ? 1 : 0);
  const [dragOver, setDragOver] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileSeq = useRef((init.files?.length || 0) + 1);
  const savingRef = useRef<Promise<void> | null>(null);
  const draftUidRef = useRef(draftUid);
  draftUidRef.current = draftUid;
  const closedRef = useRef(false);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.innerHTML = init.html;
    // replies: caret at the top; new messages: focus goes to the recipient field
    if (init.mode === "reply" || init.mode === "replyAll" || (init.mode === "forward" && false)) {
      ed.focus();
      const r = document.createRange();
      r.setStart(ed, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }, [init]);

  const totalSize = useMemo(() => refs.reduce((s, r) => s + r.size, 0) + files.reduce((s, f) => s + f.file.size, 0), [refs, files]);
  const touch = () => setDirty((d) => d + 1);

  const payload = useCallback(
    (uid?: number) => {
      const fd = new FormData();
      fd.append(
        "data",
        JSON.stringify({
          to, cc, bcc, subject,
          html: editorRef.current?.innerHTML || "",
          inReplyTo: init.inReplyTo,
          references: init.references,
          replyRef: init.replyRef,
          attachRefs: refs.map(({ folder, uid, index }) => ({ folder, uid, index })),
          draftUid: uid,
        }),
      );
      files.forEach((f) => fd.append("file", f.file, f.file.name));
      return fd;
    },
    [to, cc, bcc, subject, refs, files, init],
  );

  const saveDraft = useCallback(async () => {
    if (closedRef.current) return;
    if (savingRef.current) await savingRef.current;
    if (closedRef.current) return;
    setDraftState("saving");
    const p = (async () => {
      try {
        const res = await fetch("/api/draft", { method: "POST", body: payload(draftUidRef.current) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error);
        if (data.uid) {
          setDraftUid(data.uid);
          draftUidRef.current = data.uid;
          // local attachments saved with the draft now live inside it
        }
        setDraftState("saved");
        onDraftSaved();
      } catch {
        setDraftState("error");
      }
    })();
    savingRef.current = p;
    await p;
    savingRef.current = null;
  }, [payload, onDraftSaved]);

  // autosave the draft 4 s after the last change
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(saveDraft, 4000);
    return () => clearTimeout(t);
  }, [dirty, saveDraft]);

  async function send() {
    if (closedRef.current) return;
    if (!to.length && !cc.length && !bcc.length) {
      onError(t("errors.noRecipients"));
      return;
    }
    if (totalSize > MAX_TOTAL) {
      onError(t("errors.attachmentsTooBig"));
      return;
    }
    if (
      !subject.trim() &&
      !(await confirmDialog({ title: t("composer.noSubjectTitle"), text: t("composer.noSubjectText"), confirm: t("composer.send"), icon: "subject" }))
    )
      return;
    // no autosave once the send is queued (it would leave an orphan draft)
    closedRef.current = true;
    if (savingRef.current) await savingRef.current;
    onQueue(payload(draftUidRef.current), {
      ...init,
      key: nextKey(),
      to, cc, bcc, subject,
      html: editorRef.current?.innerHTML || "",
      attachRefs: refs,
      files: files.map((f) => f.file),
      draftUid: draftUidRef.current,
      restored: true,
    });
  }

  async function discard() {
    closedRef.current = true;
    if (savingRef.current) await savingRef.current;
    if (draftUidRef.current) {
      await fetch(`/api/draft?uid=${draftUidRef.current}`, { method: "DELETE" }).catch(() => {});
      onDiscarded();
    }
    onClose();
  }

  async function close() {
    if (dirty && draftState !== "saved") await saveDraft();
    closedRef.current = true;
    onClose();
  }

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const add = arr.reduce((s, f) => s + f.size, 0);
    if (totalSize + add > MAX_TOTAL) {
      onError(t("errors.attachmentsTooBig"));
      return;
    }
    setFiles((f) => [...f, ...arr.map((file) => ({ id: fileSeq.current++, file }))]);
    touch();
  }

  // M3 toggle buttons: the formatting at the caret shows as selected
  const [fmt, setFmt] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const read = () => {
      const ed = editorRef.current;
      const sel = window.getSelection();
      if (!ed || !sel?.anchorNode || !ed.contains(sel.anchorNode)) return;
      const q = (c: string) => {
        try {
          return document.queryCommandState(c);
        } catch {
          return false;
        }
      };
      setFmt({
        bold: q("bold"), italic: q("italic"), underline: q("underline"), strikeThrough: q("strikeThrough"),
        insertUnorderedList: q("insertUnorderedList"), insertOrderedList: q("insertOrderedList"),
      });
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    touch();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const status =
    draftState === "saving" ? t("composer.saving") : draftState === "saved" ? t("composer.draftSaved") : draftState === "error" ? t("composer.draftFailed") : "";

  const title = subject.trim() || (init.mode === "reply" || init.mode === "replyAll" ? t("composer.titleReply") : init.mode === "forward" ? t("composer.titleForward") : t("composer.titleNew"));

  if (mode === "min") {
    return (
      <div className="m3-sheet-in fixed bottom-0 end-4 z-50 w-[320px]">
        <button
          type="button"
          onClick={() => setMode("normal")}
          className="flex h-12 w-full items-center gap-2 rounded-t-2xl bg-surface-high px-4 text-left text-[14px] font-medium text-fg shadow-pop"
        >
          <span className="flex-1 truncate">{title}</span>
          <Icon name="open_in_full" size={16} className="opacity-70" />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            className="grid h-6 w-6 place-items-center rounded opacity-70 hover:opacity-100"
          >
            <Icon name="close" size={16} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      {mode === "max" && <div className="m3-scrim-in fixed inset-0 z-40 bg-scrim" onClick={() => setMode("normal")} />}
      <div
        onKeyDown={onKey}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cx(
          "m3-sheet-in fixed z-50 flex flex-col overflow-hidden bg-panel shadow-e3",
          mode === "max"
            ? "inset-0 sm:inset-x-[8vw] sm:inset-y-[5vh] sm:rounded-[28px]"
            : "inset-0 sm:inset-auto sm:bottom-0 sm:end-6 sm:h-[min(660px,100dvh)] sm:w-[600px] sm:rounded-t-[16px]",
        )}
      >
        {/* title bar */}
        <div className="flex h-12 shrink-0 items-center gap-0.5 bg-surface-high ps-5 pe-2">
          <span className="flex-1 truncate text-[15px] font-medium">{title}</span>
          <IconButton label={t("composer.minimize")} size="sm" onClick={() => setMode("min")} className="max-sm:hidden"><Icon name="minimize" size={20} /></IconButton>
          <IconButton label={mode === "max" ? t("composer.restore") : t("composer.maximize")} size="sm" className="max-sm:hidden" onClick={() => setMode(mode === "max" ? "normal" : "max")}>
            {mode === "max" ? <Icon name="close_fullscreen" size={20} /> : <Icon name="open_in_full" size={20} />}
          </IconButton>
          <IconButton label={t("composer.closeSave")} size="sm" onClick={close}><Icon name="close" size={22} /></IconButton>
        </div>

        {/* fields */}
        <div className="shrink-0 px-5">
          <RecipientField
            label={t("common.to")}
            value={to}
            onChange={(v) => { setTo(v); touch(); }}
            contacts={contacts}
            autoFocus={init.mode === "new" || init.mode === "forward"}
            right={
              (!showCc || !showBcc) && (
                <span className="flex items-center">
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="sl h-8 rounded-full px-3 type-label-large text-accent">{t("common.cc")}</button>
                  )}
                  {!showBcc && (
                    <button type="button" onClick={() => setShowBcc(true)} className="sl h-8 rounded-full px-3 type-label-large text-accent">{t("common.bcc")}</button>
                  )}
                </span>
              )
            }
          />
          {showCc && <RecipientField label={t("common.cc")} value={cc} onChange={(v) => { setCc(v); touch(); }} contacts={contacts} autoFocus />}
          {showBcc && <RecipientField label={t("common.bcc")} value={bcc} onChange={(v) => { setBcc(v); touch(); }} contacts={contacts} autoFocus={!showCc || cc.length > 0} />}
          <div className="flex items-center border-b border-line-2">
            <input
              value={subject}
              onChange={(e) => { setSubject(e.target.value); touch(); }}
              placeholder={t("composer.subject")}
              dir="auto"
              className="h-12 w-full bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-muted"
            />
          </div>
        </div>

        {/* body */}
        <div className="relative flex-1 overflow-y-auto px-5 py-4" onClick={(e) => e.target === e.currentTarget && editorRef.current?.focus()}>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={touch}
            onPaste={(e) => {
              // pasted files (screenshots) become attachments; rich text is simplified
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
                return;
              }
              const html = e.clipboardData.getData("text/html");
              if (html) {
                e.preventDefault();
                const tmp = document.createElement("div");
                tmp.innerHTML = html;
                tmp.querySelectorAll("script,style,meta,link,iframe,object,embed,form,input,button,svg").forEach((n) => n.remove());
                tmp.querySelectorAll("*").forEach((n) => {
                  [...n.attributes].forEach((a) => {
                    if (a.name.startsWith("on") || a.name === "class" || a.name === "id" || (a.name === "style" && n.tagName !== "SPAN")) n.removeAttribute(a.name);
                  });
                });
                document.execCommand("insertHTML", false, tmp.innerHTML);
              }
            }}
            data-placeholder={t("composer.placeholder")}
            dir="auto"
            className="editor min-h-[160px] text-[15px]"
          />
          {dragOver && (
            <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/90 text-[15px] font-medium text-on-accent-soft animate-fade">
              {t("composer.dropFiles")}
            </div>
          )}
        </div>

        {/* attachments */}
        {(refs.length > 0 || files.length > 0) && (
          <div className="flex max-h-[120px] shrink-0 flex-wrap gap-2 overflow-y-auto px-5 py-2.5">
            {refs.map((r) => (
              <Chip key={`r${r.index}`} name={r.filename} size={r.size} onRemove={() => { setRefs((x) => x.filter((y) => y !== r)); touch(); }} />
            ))}
            {files.map((f) => (
              <Chip key={f.id} name={f.file.name} size={f.file.size} onRemove={() => { setFiles((x) => x.filter((y) => y.id !== f.id)); touch(); }} />
            ))}
            <span className={cx("self-center text-[11.5px] tabular-nums", totalSize > MAX_TOTAL ? "text-danger" : "text-faint")}>
              {fileSize(totalSize)} / 25 MB
            </span>
          </div>
        )}

        {/* bottom bar */}
        <div className="flex shrink-0 items-center gap-1 px-3 pb-3 pt-2">
          <Button variant="filled" icon="send" onClick={send} data-tip={t("composer.sendKey", { key: isMac() ? "⌘" : "Ctrl" })}>
            {t("composer.send")}
          </Button>
          <div className="ms-1 flex items-center">
            <IconButton label={t("composer.attach")} onClick={() => fileInput.current?.click()}><Icon name="attach_file" /></IconButton>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <div className="mx-1 h-5 w-px bg-line" />
            <div className="hidden items-center sm:flex">
              {FORMAT.map(([cmd, icon, labelKey]) => (
                <IconButton
                  key={cmd}
                  label={t(labelKey)}
                  size="sm"
                  selected={cmd in fmt ? !!fmt[cmd] : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (cmd === "blockquote" ? exec("formatBlock", "blockquote") : exec(cmd))}
                  className={fmt[cmd] ? "bg-select !text-on-select" : ""}
                >
                  <Icon name={icon} size={20} />
                </IconButton>
              ))}
              <IconButton
                label={t("composer.addLink")}
                size="sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  const sel = window.getSelection();
                  const range = sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
                  const url = await promptDialog({
                    title: t("composer.addLink"),
                    label: t("composer.linkAddress"),
                    initial: "https://",
                    confirm: t("common.add"),
                    validate: (v) => (/^(https?:\/\/\S+|mailto:\S+)$/i.test(v.trim()) ? null : t("composer.linkInvalid")),
                  });
                  if (!url) return;
                  editorRef.current?.focus();
                  if (range) {
                    const s2 = window.getSelection();
                    s2?.removeAllRanges();
                    s2?.addRange(range);
                  }
                  if (range && !range.collapsed) exec("createLink", url.trim());
                  else exec("insertHTML", `<a href="${url.trim().replace(/"/g, "&quot;")}">${url.trim().replace(/</g, "&lt;")}</a>`);
                }}
              >
                <Icon name="link" size={20} />
              </IconButton>
              <IconButton label={t("composer.clearFormat")} size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")}><Icon name="format_clear" size={20} /></IconButton>
            </div>
          </div>
          <div className="flex-1" />
          <span className={cx("me-1 hidden items-center gap-1.5 type-body-small md:flex", draftState === "error" ? "text-danger" : "text-muted")}>
            {draftState === "saving" && <Spinner className="h-4 w-4 text-accent" />}
            {status}
          </span>
          <IconButton label={t("composer.discard")} onClick={discard} className="hover:!text-danger"><Icon name="delete" /></IconButton>
        </div>
      </div>
    </>
  );
}

function Chip({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="group inline-flex h-8 max-w-[260px] items-center gap-2 rounded-lg border border-line ps-2.5 pe-1 text-[13px]">
      <Icon name="attach_file" size={16} className="shrink-0 text-muted" />
      <span className="truncate font-medium text-fg">{name}</span>
      <span className="shrink-0 text-muted">{fileSize(size)}</span>
      <button type="button" onClick={onRemove} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg" aria-label={t("composer.removeAttachment")}>
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}

function RecipientField({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
  right,
}: {
  label: string;
  value: Addr[];
  onChange: (v: Addr[]) => void;
  contacts: Addr[];
  autoFocus?: boolean;
  right?: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = text.trim().toLocaleLowerCase(locale);
    if (!q) return [];
    const taken = new Set(value.map((v) => v.address));
    return contacts
      .filter((c) => !taken.has(c.address) && (c.address.includes(q) || (c.name || "").toLocaleLowerCase(locale).includes(q)))
      .slice(0, 6);
  }, [text, contacts, value, locale]);

  useEffect(() => setHi(0), [text]);

  const commit = (raw = text) => {
    const parts = raw.split(/[,;\n]+/).map(parseAddr);
    const good = parts.filter((p): p is Addr => !!p && !value.some((v) => v.address === p.address));
    if (good.length) onChange([...value, ...good]);
    const bad = raw.split(/[,;\n]+/).filter((r, i) => r.trim() && !parts[i]);
    setText(bad.join(", "));
  };

  const pick = (a: Addr) => {
    onChange([...value, a]);
    setText("");
    input.current?.focus();
  };

  return (
    <div className="relative flex min-h-12 items-start gap-2 border-b border-line-2 py-2" onClick={() => input.current?.focus()}>
      <span className="min-w-12 shrink-0 pt-[6px] type-body-large text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a) => {
          const valid = EMAIL_RE.test(a.address);
          return (
            <span
              key={a.address}
              data-tip={a.name ? a.address : undefined}
              className={cx(
                "inline-flex h-8 max-w-full items-center gap-2 rounded-lg border ps-1 pe-1 type-label-large",
                valid ? "border-faint text-muted" : "border-danger bg-danger-soft text-on-danger-soft",
              )}
            >
              <Avatar addr={a} size={24} />
              <span className="truncate">{a.name || a.address}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== a));
                }}
                className="sl grid h-6 w-6 place-items-center rounded-full"
                aria-label={t("composer.removeRecipient", { address: a.address })}
              >
                <Icon name="close" size={18} />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) commit(v);
            else setText(v);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            if (text.trim()) commit();
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              commit(text + t);
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length && text.trim()) {
              e.preventDefault();
              pick(suggestions[hi]);
            } else if ((e.key === "Enter" || e.key === "Tab") && text.trim()) {
              if (e.key === "Enter") e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="h-8 min-w-[120px] flex-1 bg-transparent text-[15px] outline-none"
        />
      </div>
      {right && <div className="shrink-0 pt-[3px]">{right}</div>}
      {focus && suggestions.length > 0 && (
        <div role="listbox" className="m3-menu-in absolute start-14 end-0 top-full z-10 mt-1 overflow-hidden rounded-[4px] bg-panel-2 py-2 shadow-e2 dark:bg-surface-high">
          {suggestions.map((s, i) => (
            <button
              key={s.address}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHi(i)}
              className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === hi && "bg-hover")}
            >
              <Avatar addr={s} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{displayName(s)}</span>
                <span className="block truncate text-[12.5px] text-muted">{s.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
