"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, displayName } from "@/lib/client";
import { draftCompose, forwardCompose, newCompose, replyCompose, type ComposeInit } from "@/lib/compose-client";
import type { Addr, Folder, MessageFull, MessageList as List, MessageSummary, Settings } from "@/lib/types";
import { NavRail, Sidebar, folderLabel, type Theme } from "./Sidebar";
import { MessageList, type Filter, type RowAction, type Scope } from "./MessageList";
import { forgetFull, Reader, ReaderEmpty, type ReaderActions } from "./Reader";
import { Composer } from "./Composer";
import { TopBar } from "./TopBar";
import { AppearanceDialog, FolderDialog, MoveMenu, SettingsDialog, ShortcutsDialog, Toasts, type FolderDialogState, type Toast } from "./dialogs";
import { cx } from "./ui";
import { Icon } from "./ui";
import { confirmDialog } from "@/lib/dialog-service";
import { useBrand, useT } from "@/i18n/client";

const listCache = new Map<string, List>();

function readUrl() {
  if (typeof window === "undefined") return { f: "INBOX", m: null as number | null };
  const p = new URLSearchParams(window.location.search);
  const m = Number(p.get("m"));
  return { f: p.get("f") || "INBOX", m: Number.isInteger(m) && m > 0 ? m : null };
}

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

function useMedia(q: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return on;
}

export function MailApp({ email, initialFolder = "INBOX", initialUid = null }: { email: string; initialFolder?: string; initialUid?: number | null }) {
  const t = useT();
  const brand = useBrand();
  const initial = useMemo(() => ({ f: initialFolder, m: initialUid }), [initialFolder, initialUid]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState(initial.f);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>("folder");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState("");
  const [openUid, setOpenUid] = useState<number | null>(initial.m);
  const [cursor, setCursor] = useState(-1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allInFolder, setAllInFolder] = useState(false); // "select all in folder"
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [settings, setSettings] = useState<Settings>({ name: email.split("@")[0], signature: "", loadImages: false, undoSeconds: 10 });
  const [contacts, setContacts] = useState<Addr[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<Theme>("system");
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<null | "settings" | "shortcuts" | "appearance">(null);
  const [fabExtended, setFabExtended] = useState(true);
  const isXl = useMedia("(min-width: 1280px)");
  const [navOpen, setNavOpen] = useState(false);
  const [move, setMove] = useState<{ uids: number[]; all?: boolean } | null>(null);
  const [folderDlg, setFolderDlg] = useState<FolderDialogState | null>(null);
  const [notifyOn, setNotifyOn] = useState(false);
  const [threadRev, setThreadRev] = useState(0); // bumps to reload the open thread after a reply is sent
  const moveAnchor = useRef<HTMLElement | null>(null);
  const latestRef = useRef<MessageFull | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const lastSelect = useRef<number | null>(null);

  const current = folders.find((f) => f.path === folder);
  const sp = useMemo(() => {
    const by = (s: Folder["special"]) => folders.find((f) => f.special === s)?.path;
    return { inbox: by("inbox") || "INBOX", sent: by("sent"), drafts: by("drafts"), trash: by("trash"), archive: by("archive"), junk: by("junk") };
  }, [folders]);
  const msgs = list?.messages || [];
  const searchingAll = scope === "all" && !!applied;
  // in all-folder search each row carries its folder; otherwise it is the open folder
  const rowFolder = useCallback((m: MessageSummary) => m.folder || folder, [folder]);
  const isJunk = !!sp.junk && folder === sp.junk;
  const isTrash = !!sp.trash && folder === sp.trash;

  // ---------- snackbars ----------
  // a snackbar plays its exit animation before it is removed
  const dismissToast = useCallback((id: number) => {
    setToasts((x) => x.map((y) => (y.id === id ? { ...y, leaving: true } : y)));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 160);
  }, []);
  const toast = useCallback(
    (t: Omit<Toast, "id">, ms = 5000) => {
      const id = Date.now() + Math.random();
      setToasts((x) => [...x.slice(-2), { ...t, id }]);
      setTimeout(() => dismissToast(id), ms);
      return id;
    },
    [dismissToast],
  );
  const fail = useCallback(
    (e: unknown) => toast({ text: (typeof e === "string" ? e : (e as Error)?.message) || t("common.somethingWrong"), tone: "error" }, 6000),
    [toast, t],
  );

  // ---------- theme ----------
  useEffect(() => {
    let saved: Theme = "system";
    try {
      saved = (localStorage.getItem("mw-theme") as Theme) || "system";
    } catch {}
    setThemeState(saved);
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const d = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = d ? "dark" : "light";
      setDark(d);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem("mw-theme", next);
    } catch {}
  };

  // ---------- data ----------
  const loadFolders = useCallback(async () => {
    try {
      const r = await api<{ folders: Folder[] }>("/api/folders");
      setFolders(r.folders);
      onFoldersLoadedRef.current(r.folders);
    } catch {}
  }, []);

  // ---------- desktop notifications ----------
  // The highest unread UID in the Inbox is the baseline; only newer messages are announced.
  const notifyBase = useRef<number | null>(null);
  const inboxStat = useRef("");
  const openFromNotice = useRef<(uid: number) => void>(() => {});

  useEffect(() => {
    try {
      setNotifyOn(localStorage.getItem("mw-notify") === "1" && "Notification" in window && Notification.permission === "granted");
    } catch {}
  }, []);

  const setNotify = useCallback(async (on: boolean) => {
    if (!("Notification" in window)) throw new Error(t("app.noNotifications"));
    if (on && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") throw new Error(t("app.notifyDenied"));
    }
    try {
      localStorage.setItem("mw-notify", on ? "1" : "0");
    } catch {}
    notifyBase.current = null;
    setNotifyOn(on);
  }, [t]);

  const checkNew = useCallback(
    async (inbox: string) => {
      try {
        const r = await api<List>(`/api/messages?${new URLSearchParams({ folder: inbox, page: "0", filter: "unread" })}`);
        const max = r.messages.reduce((m, x) => Math.max(m, x.uid), 0);
        const base = notifyBase.current;
        notifyBase.current = Math.max(base ?? 0, max);
        if (base === null) return;
        const fresh = r.messages.filter((m) => m.uid > base);
        if (!fresh.length || (document.visibilityState === "visible" && document.hasFocus())) return;
        const show = (title: string, body: string, uid?: number) => {
          const n = new Notification(title, { body, icon: "/icon-192.png", tag: uid ? `mail-${uid}` : "mail-many" });
          n.onclick = () => {
            window.focus();
            if (uid) openFromNotice.current(uid);
            n.close();
          };
        };
        if (fresh.length > 3) show(t("app.newMessages", { count: fresh.length }), fresh.slice(0, 3).map((m) => displayName(m.from[0])).join(", ") + "…");
        else fresh.forEach((m) => show(displayName(m.from[0]), [m.subject || t("common.noSubject"), m.snippet].filter(Boolean).join("\n").slice(0, 180), m.uid));
      } catch {}
    },
    [t],
  );

  const onFoldersLoaded = useCallback(
    (fs: Folder[]) => {
      const inbox = fs.find((f) => f.special === "inbox");
      if (!inbox || !notifyOn) return;
      const stat = `${inbox.unseen}|${inbox.total}`;
      if (stat === inboxStat.current && notifyBase.current !== null) return;
      inboxStat.current = stat;
      checkNew(inbox.path);
    },
    [notifyOn, checkNew],
  );
  const onFoldersLoadedRef = useRef(onFoldersLoaded);
  onFoldersLoadedRef.current = onFoldersLoaded;
  useEffect(() => {
    if (notifyOn && folders.length) onFoldersLoadedRef.current(folders);
    // set up the baseline only when notifications get turned on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyOn]);

  const listFolder = searchingAll ? "*" : folder;
  const listKey = `${listFolder}|${filter}|${applied}|${page}`;
  const loadList = useCallback(
    async (silent = false) => {
      const id = ++reqId.current;
      const key = `${listFolder}|${filter}|${applied}|${page}`;
      const cached = listCache.get(key);
      if (!silent) {
        if (cached) setList(cached);
        else setList((l) => (l && l.folder === listFolder ? l : null));
        setLoading(true);
      } else setRefreshing(true);
      try {
        const qs = new URLSearchParams({ folder, page: String(page), filter });
        if (applied) qs.set("q", applied);
        if (searchingAll) qs.set("scope", "all");
        const r = await api<List>(`/api/messages?${qs}`);
        if (id !== reqId.current) return;
        listCache.set(key, r);
        setList(r);
        setListError("");
      } catch (e) {
        if (id === reqId.current) setListError((e as Error).message);
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [folder, listFolder, searchingAll, filter, applied, page],
  );

  useEffect(() => {
    loadFolders();
    api<Settings>("/api/settings").then(setSettings).catch(() => {});
    const t = setInterval(loadFolders, 60_000);
    const onFocus = () => {
      loadFolders();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadFolders]);

  useEffect(() => {
    loadList();
  }, [listKey, loadList]);

  // live updates (IDLE → SSE)
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource(`/api/events?folder=${encodeURIComponent(folder)}`);
      es.addEventListener("change", () => {
        loadListRef.current(true);
        loadFolders();
      });
      es.addEventListener("fail", () => {
        es?.close();
        retry = setTimeout(connect, 30_000);
      });
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [folder, loadFolders]);

  // URL and title. Opening a message pushes a history entry, so the phone back button closes the reader.
  const prevOpen = useRef<number | null>(initial.m);
  useEffect(() => {
    const p = new URLSearchParams();
    if (folder !== "INBOX") p.set("f", folder);
    if (openUid) p.set("m", String(openUid));
    const s = p.toString();
    const url = s ? `/?${s}` : "/";
    const opened = !!openUid && !prevOpen.current;
    prevOpen.current = openUid;
    const cur = window.location.pathname + window.location.search;
    if (cur === url) return; // arrived via back/forward, history is already right
    if (opened) window.history.pushState({ pushed: true }, "", url);
    else window.history.replaceState({ pushed: !!window.history.state?.pushed }, "", url);
  }, [folder, openUid]);
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setNavOpen(false);
      setFolder((f) => (f === u.f ? f : u.f));
      setOpenUid(u.m);
      if (!u.m) setCursor(-1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Close the reader: go back if we pushed the entry (keeps browser history from growing)
  const closeReader = useCallback(() => {
    if (window.history.state?.pushed) window.history.back();
    else setOpenUid(null);
  }, []);
  const openNav = useCallback(() => {
    window.history.pushState({ pushed: !!window.history.state?.pushed, nav: true }, "");
    setNavOpen(true);
  }, []);
  const closeNav = useCallback(() => {
    if (window.history.state?.nav) window.history.back();
    else setNavOpen(false);
  }, []);
  useEffect(() => {
    const inbox = folders.find((f) => f.special === "inbox");
    const n = inbox?.unseen || 0;
    document.title = `${n ? `(${n}) ` : ""}${folderLabel(current, t) || t("app.mail")} · ${brand.name}`;
  }, [folders, current, t, brand.name]);

  // ---------- local updates ----------
  const patchMsgs = useCallback(
    (uids: number[], patch: Partial<MessageSummary>, from = folder) => {
      const set = new Set(uids);
      setList((l) => (l ? { ...l, messages: l.messages.map((m) => (set.has(m.uid) && (m.folder || folder) === from ? { ...m, ...patch } : m)) } : l));
      listCache.clear();
    },
    [folder],
  );

  const bumpUnseen = useCallback((path: string, delta: number) => {
    setFolders((fs) => fs.map((f) => (f.path === path ? { ...f, unseen: Math.max(0, f.unseen + delta) } : f)));
  }, []);

  const dropFromList = useCallback(
    (uids: number[], from = folder) => {
      const set = new Set(uids);
      const hit = (m: MessageSummary) => set.has(m.uid) && rowFolder(m) === from;
      if (openUid && from === folder && set.has(openUid)) {
        const idx = msgs.findIndex((m) => m.uid === openUid && rowFolder(m) === folder);
        const rest = msgs.filter((m) => !hit(m));
        const next = msgs.slice(idx + 1).find((m) => !hit(m)) || msgs.slice(0, idx).reverse().find((m) => !hit(m));
        // only open the next message when it is in the same folder (all-folder search must not switch folders)
        const openNext = next && window.innerWidth >= 768 && rowFolder(next) === folder;
        setOpenUid(openNext ? next.uid : null);
        setCursor(next ? rest.indexOf(next) : -1);
      }
      setList((l) => (l ? { ...l, total: Math.max(0, l.total - uids.length), messages: l.messages.filter((m) => !hit(m)) } : l));
      setSelected(new Set());
      setAllInFolder(false);
      listCache.clear();
    },
    [openUid, msgs, folder, rowFolder],
  );

  // ---------- actions ----------
  const setFlag = useCallback(
    async (uids: number[], flag: "seen" | "flagged", value: boolean, from = folder) => {
      const before = msgs.filter((m) => uids.includes(m.uid) && rowFolder(m) === from);
      patchMsgs(uids, flag === "seen" ? { seen: value } : { flagged: value }, from);
      if (flag === "seen") {
        const changed = before.filter((m) => m.seen !== value).length;
        if (changed) bumpUnseen(from, value ? -changed : changed);
      }
      try {
        await api("/api/flags", { method: "POST", json: { folder: from, uids, flag, value } });
      } catch (e) {
        fail(e);
        loadList(true);
        loadFolders();
      }
    },
    [msgs, folder, rowFolder, patchMsgs, bumpUnseen, fail, loadList, loadFolders],
  );

  const moveTo = useCallback(
    async (uids: number[], to: string, verb?: string, from = folder) => {
      // verb: the toast text; defaults to "moved to <folder>"
      if (!uids.length || to === from) return;
      const unseen = msgs.filter((m) => uids.includes(m.uid) && rowFolder(m) === from && !m.seen).length;
      dropFromList(uids, from);
      if (unseen) bumpUnseen(from, -unseen);
      uids.forEach((u) => forgetFull(from, u));
      try {
        const r = await api<{ to: string; uids: number[] }>("/api/move", { method: "POST", json: { folder: from, uids, to } });
        const label = folderLabel(folders.find((f) => f.path === to), t) || to;
        toast({
          text: verb || t("app.movedTo", { count: uids.length, folder: label }),
          action: r.uids.length
            ? {
                label: t("common.undo"),
                run: async () => {
                  try {
                    await api("/api/move", { method: "POST", json: { folder: to, uids: r.uids, to: from } });
                    loadList(true);
                    loadFolders();
                  } catch (e) {
                    fail(e);
                  }
                },
              }
            : undefined,
        });
        loadFolders();
      } catch (e) {
        fail(e);
        loadList(true);
      }
    },
    [folder, folders, msgs, rowFolder, dropFromList, bumpUnseen, toast, fail, loadList, loadFolders, t],
  );

  const remove = useCallback(
    async (uids: number[], from = folder) => {
      if (!uids.length) return;
      const permanent = !sp.trash || from === sp.trash || from === sp.junk;
      if (
        permanent &&
        !(await confirmDialog({
          title: t("app.deletePermanentTitle"),
          text: t("app.deletePermanentText", { count: uids.length }),
          confirm: t("common.delete"),
          danger: true,
          icon: "delete_forever",
        }))
      )
        return;
      const unseen = msgs.filter((m) => uids.includes(m.uid) && rowFolder(m) === from && !m.seen).length;
      dropFromList(uids, from);
      if (unseen) bumpUnseen(from, -unseen);
      uids.forEach((u) => forgetFull(from, u));
      try {
        const r = await api<{ permanent: boolean; to?: string; uids?: number[] }>("/api/delete", { method: "POST", json: { folder: from, uids } });
        toast({
          text: r.permanent ? t("app.deletedForever") : t("app.movedToTrash", { count: uids.length }),
          action:
            !r.permanent && r.to && r.uids?.length
              ? {
                  label: t("common.undo"),
                  run: async () => {
                    try {
                      await api("/api/move", { method: "POST", json: { folder: r.to, uids: r.uids, to: from } });
                      loadList(true);
                      loadFolders();
                    } catch (e) {
                      fail(e);
                    }
                  },
                }
              : undefined,
        });
        loadFolders();
      } catch (e) {
        fail(e);
        loadList(true);
      }
    },
    [folder, sp, msgs, rowFolder, dropFromList, bumpUnseen, toast, fail, loadList, loadFolders, t],
  );

  const archive = useCallback(
    (uids: number[], from = folder) => sp.archive && from !== sp.archive && moveTo(uids, sp.archive, t("app.archived", { count: uids.length }), from),
    [sp.archive, folder, moveTo, t],
  );
  const spam = useCallback(
    (uids: number[], from = folder) => sp.junk && from !== sp.junk && moveTo(uids, sp.junk, t("app.movedToJunk", { count: uids.length }), from),
    [sp.junk, folder, moveTo, t],
  );
  const notSpam = useCallback(
    (uids: number[], from = folder) => from === sp.junk && moveTo(uids, sp.inbox, t("app.movedToInbox", { count: uids.length }), from),
    [sp.junk, sp.inbox, folder, moveTo, t],
  );

  // Every message in the folder ("select all"): 1:* on the server, then reload the list
  const bulkAll = useCallback(
    async (action: "read" | "unread" | "star" | "delete" | "archive" | "spam" | "move", to?: string) => {
      const total = list?.total || 0;
      const count = { count: total };
      try {
        if (action === "read" || action === "unread" || action === "star") {
          await api("/api/flags", { method: "POST", json: { folder, uids: "all", flag: action === "star" ? "flagged" : "seen", value: action !== "unread" } });
          toast({ text: t(action === "read" ? "app.allMarkedRead" : action === "unread" ? "app.allMarkedUnread" : "app.allStarred", count) });
        } else if (action === "delete") {
          const permanent = !sp.trash || isTrash || isJunk;
          if (
            !(await confirmDialog({
              title: permanent ? t("app.deleteAllPermanentTitle") : t("app.trashAllTitle"),
              text: permanent ? t("app.deleteAllPermanentText", count) : t("app.trashAllText", count),
              confirm: permanent ? t("common.delete") : t("app.moveToTrash"),
              danger: true,
              icon: permanent ? "delete_forever" : "delete",
            }))
          )
            return;
          await api("/api/delete", { method: "POST", json: { folder, uids: "all" } });
          toast({ text: permanent ? t("app.allDeletedForever", count) : t("app.allMovedToTrash", count) });
        } else {
          const dest = action === "archive" ? sp.archive : action === "spam" ? sp.junk : to;
          if (!dest || dest === folder) return;
          await api("/api/move", { method: "POST", json: { folder, uids: "all", to: dest } });
          toast({ text: t("app.allMovedTo", { count: total, folder: folderLabel(folders.find((f) => f.path === dest), t) || dest }) });
        }
      } catch (e) {
        fail(e);
      }
      setSelected(new Set());
      setAllInFolder(false);
      setOpenUid(null);
      listCache.clear();
      loadList(true);
      loadFolders();
    },
    [list?.total, folder, folders, sp, isTrash, isJunk, toast, fail, loadList, loadFolders, t],
  );

  // ---------- compose ----------
  const ensureContacts = useCallback(() => {
    if (contacts.length) return;
    api<{ contacts: Addr[] }>("/api/contacts").then((r) => setContacts(r.contacts)).catch(() => {});
  }, [contacts.length]);

  const openCompose = useCallback(
    (init: ComposeInit) => {
      ensureContacts();
      setCompose(init);
    },
    [ensureContacts],
  );

  const openMessage = useCallback(
    async (m: MessageSummary, i: number) => {
      setCursor(i);
      setNavOpen(false);
      const f = m.folder || folder;
      if (m.draft || (sp.drafts && f === sp.drafts)) {
        try {
          const full = await api<MessageFull>(`/api/message?folder=${encodeURIComponent(f)}&uid=${m.uid}&images=1&peek=1`);
          openCompose(draftCompose(full, full.html));
        } catch (e) {
          fail(e);
        }
        return;
      }
      // all-folder search: switch to the result's folder but keep the search results
      if (f !== folder) {
        setFolder(f);
        setSelected(new Set());
      }
      setOpenUid(m.uid);
    },
    [folder, sp.drafts, openCompose, fail],
  );

  const goFolder = useCallback((path: string) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setFolder(path);
    setPage(0);
    setFilter("all");
    setScope("folder");
    setQuery("");
    setApplied("");
    setOpenUid(null);
    setCursor(-1);
    setSelected(new Set());
    setAllInFolder(false);
    setNavOpen(false);
  }, []);

  openFromNotice.current = (uid: number) => {
    goFolder(sp.inbox);
    setOpenUid(uid);
  };

  // ---------- send queue (undo period) ----------
  type Outgoing = { body: FormData; restore: ComposeInit; timer?: ReturnType<typeof setTimeout> };
  const outbox = useRef(new Map<number, Outgoing>());
  const sentCtx = useRef({ folder, openUid, sp });
  sentCtx.current = { folder, openUid, sp };

  const deliver = useCallback(
    async (id: number) => {
      const o = outbox.current.get(id);
      if (!o) return;
      outbox.current.delete(id);
      const busy = toast({ text: t("app.sending"), busy: true }, 120_000);
      try {
        const res = await fetch("/api/send", { method: "POST", body: o.body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(res.status, data.error || t("errors.sendFailed"));
        const warnings: string[] = data.warnings || [];
        dismissToast(busy);
        toast({ text: warnings.length ? t("app.sentWithWarning", { warning: warnings[0] }) : t("app.sent"), tone: "ok" });
        const c = sentCtx.current;
        if (c.folder === c.sp.sent || c.folder === c.sp.drafts) loadListRef.current(true);
        const ref = o.restore.replyRef;
        if (ref && c.openUid === ref.uid && c.folder === ref.folder) {
          patchMsgs([ref.uid], { answered: true });
          setThreadRev((r) => r + 1);
        }
        loadFolders();
      } catch (e) {
        dismissToast(busy);
        fail(new Error(t("app.reopened", { error: (e as Error).message })));
        ensureContacts();
        setCompose(o.restore);
      }
    },
    [toast, dismissToast, fail, patchMsgs, loadFolders, ensureContacts, t],
  );

  const queueSend = useCallback(
    (body: FormData, restore: ComposeInit) => {
      setCompose(null);
      const id = restore.key;
      const secs = settings.undoSeconds;
      outbox.current.set(id, { body, restore });
      if (!secs) {
        deliver(id);
        return;
      }
      outbox.current.get(id)!.timer = setTimeout(() => deliver(id), secs * 1000);
      toast(
        {
          text: t("app.sending"),
          countdown: secs,
          action: {
            label: t("common.undo"),
            run: () => {
              const o = outbox.current.get(id);
              if (!o) return;
              clearTimeout(o.timer);
              outbox.current.delete(id);
              setCompose(o.restore);
            },
          },
          secondary: {
            label: t("app.sendNow"),
            run: () => {
              const o = outbox.current.get(id);
              if (!o) return;
              clearTimeout(o.timer);
              deliver(id);
            },
          },
        },
        secs * 1000,
      );
    },
    [settings.undoSeconds, deliver, toast, t],
  );

  // Don't lose a queued send when the tab closes: warn, and send right away if it closes anyway
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!outbox.current.size) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const hide = () => {
      for (const [id, o] of outbox.current) {
        clearTimeout(o.timer);
        outbox.current.delete(id);
        fetch("/api/send", { method: "POST", body: o.body, keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("pagehide", hide);
    };
  }, []);

  // ---------- folder management ----------
  const folderOp = useCallback(
    async (op: { action: "create"; name: string; parent?: string } | { action: "rename"; path: string; name: string } | { action: "delete"; path: string }) => {
      const r = await api<{ path?: string; moved?: number }>("/api/folders", { method: "POST", json: op });
      listCache.clear();
      if (op.action === "create") toast({ text: t("app.folderCreated"), tone: "ok" });
      if (op.action === "rename" && r.path) {
        const old = op.path;
        const delim = folders.find((f) => f.path === old)?.delimiter || "/";
        if (folder === old) setFolder(r.path);
        else if (folder.startsWith(old + delim)) setFolder(r.path + folder.slice(old.length));
        toast({ text: t("app.folderRenamed"), tone: "ok" });
      }
      if (op.action === "delete") {
        if (folder === op.path) goFolder(sp.inbox);
        toast({ text: r.moved ? t("app.folderDeletedMoved", { count: r.moved }) : t("app.folderDeleted"), tone: "ok" });
      }
      await loadFolders();
    },
    [folders, folder, goFolder, sp.inbox, toast, loadFolders, t],
  );

  /** Empty Trash/Junk and mark a folder as read (sidebar menu + list header) */
  const folderQuick = useCallback(
    async (kind: "empty" | "readAll", f: Folder) => {
      const label = folderLabel(f, t);
      if (kind === "empty") {
        if (!f.total) return;
        if (
          !(await confirmDialog({
            title: t("app.emptyTitle", { folder: label }),
            text: t("app.emptyText", { count: f.total }),
            confirm: t("app.emptyConfirm"),
            danger: true,
            icon: "delete_sweep",
          }))
        )
          return;
      }
      try {
        const r = await api<{ removed?: number; count?: number }>("/api/folders", { method: "POST", json: { action: kind, path: f.path } });
        toast({ text: kind === "empty" ? t("app.emptied", { folder: label }) : t("app.folderRead", { folder: label, count: r.count || 0 }), tone: "ok" });
      } catch (e) {
        fail(e);
      }
      listCache.clear();
      if (f.path === folder) {
        setSelected(new Set());
        setAllInFolder(false);
        if (kind === "empty") setOpenUid(null);
        loadList(true);
      }
      loadFolders();
    },
    [folder, toast, fail, loadList, loadFolders, t],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!msgs.length) return;
      const idx = openUid ? msgs.findIndex((m) => m.uid === openUid) : cursor;
      const next = Math.min(msgs.length - 1, Math.max(0, idx + dir));
      if (idx === -1) {
        setCursor(0);
        return;
      }
      if (next === idx) return;
      if (openUid) openMessage(msgs[next], next);
      else setCursor(next);
    },
    [msgs, openUid, cursor, openMessage],
  );

  const openIdx = openUid ? msgs.findIndex((m) => m.uid === openUid && rowFolder(m) === folder) : -1;
  const openMsg = openIdx >= 0 ? msgs[openIdx] : undefined;

  const registerLatest = useCallback((m: MessageFull | null) => {
    latestRef.current = m;
  }, []);

  const readerActions: ReaderActions = useMemo(
    () => ({
      reply: (m, mode) => openCompose(replyCompose(m, mode, email, settings.signature)),
      forward: (m) => openCompose(forwardCompose(m, settings.signature)),
      remove: () => openUid && remove([openUid]),
      archive: sp.archive && folder !== sp.archive ? () => openUid && archive([openUid]) : undefined,
      spam: sp.junk && !isJunk && folder !== sp.trash ? () => openUid && spam([openUid]) : undefined,
      notSpam: isJunk ? () => openUid && notSpam([openUid]) : undefined,
      move: (anchor) => {
        if (!openUid) return;
        moveAnchor.current = anchor;
        setMove({ uids: [openUid] });
      },
      markUnread: () => {
        if (!openUid) return;
        setFlag([openUid], "seen", false);
        closeReader();
      },
      star: (on) => openUid && setFlag([openUid], "flagged", on),
      close: closeReader,
      prev: openIdx > 0 ? () => step(-1) : undefined,
      next: openIdx >= 0 && openIdx < msgs.length - 1 ? () => step(1) : undefined,
      mailto: (address, subject) => {
        const c = newCompose(settings.signature, [{ address }]);
        if (subject) c.subject = subject;
        openCompose(c);
      },
      onSeen: (f, uid) => {
        if (f !== folder) return;
        const m = msgs.find((x) => x.uid === uid);
        if (m && !m.seen) {
          patchMsgs([uid], { seen: true });
          bumpUnseen(f, -1);
        }
      },
    }),
    [openCompose, email, settings.signature, openUid, remove, sp.archive, sp.junk, sp.trash, isJunk, folder, archive, spam, notSpam, setFlag, openIdx, msgs, step, patchMsgs, bumpUnseen, closeReader],
  );

  // hover buttons on list rows
  const rowAction = useCallback(
    (m: MessageSummary, action: RowAction) => {
      const f = rowFolder(m);
      if (action === "archive") archive([m.uid], f);
      else if (action === "delete") remove([m.uid], f);
      else if (action === "read") setFlag([m.uid], "seen", !m.seen, f);
      else if (action === "spam") spam([m.uid], f);
      else if (action === "notSpam") notSpam([m.uid], f);
    },
    [rowFolder, archive, remove, setFlag, spam, notSpam],
  );

  // ---------- bulk selection ----------
  const toggleSelect = useCallback(
    (uid: number, shift: boolean) => {
      setSelected((s) => {
        const n = new Set(s);
        if (shift && lastSelect.current !== null) {
          const a = msgs.findIndex((m) => m.uid === lastSelect.current);
          const b = msgs.findIndex((m) => m.uid === uid);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            msgs.slice(lo, hi + 1).forEach((m) => n.add(m.uid));
            return n;
          }
        }
        if (n.has(uid)) n.delete(uid);
        else n.add(uid);
        return n;
      });
      lastSelect.current = uid;
    },
    [msgs],
  );

  const bulk = useCallback(
    (action: "read" | "unread" | "star" | "delete" | "archive" | "spam" | "move", anchor?: HTMLElement) => {
      if (allInFolder) {
        if (action === "move" && anchor) {
          moveAnchor.current = anchor;
          setMove({ uids: [], all: true });
        } else bulkAll(action);
        return;
      }
      const uids = [...selected];
      if (!uids.length) return;
      if (action === "read") setFlag(uids, "seen", true);
      if (action === "unread") setFlag(uids, "seen", false);
      if (action === "star") {
        const allStarred = msgs.filter((m) => selected.has(m.uid)).every((m) => m.flagged);
        setFlag(uids, "flagged", !allStarred);
      }
      if (action === "delete") remove(uids);
      if (action === "archive") archive(uids);
      if (action === "spam") spam(uids);
      if (action === "move" && anchor) {
        moveAnchor.current = anchor;
        setMove({ uids });
      }
      if (action === "read" || action === "unread" || action === "star") setSelected(new Set());
    },
    [selected, allInFolder, bulkAll, msgs, setFlag, remove, archive, spam],
  );

  const dropMessages = useCallback(
    (to: string, data: string) => {
      try {
        const d = JSON.parse(data) as { folder: string; uids: number[] };
        if (d.folder === folder) moveTo(d.uids, to);
      } catch {}
    },
    [folder, moveTo],
  );

  // ---------- keyboard ----------
  const gPrefix = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e) || e.altKey) return;
      if (e.metaKey || e.ctrlKey) return;
      if (compose || modal || move || folderDlg) return;
      if (document.querySelector('[role="dialog"]')) return; // an M3 confirm/prompt dialog is open
      const k = e.key;
      const target = openUid ? [openUid] : selected.size ? [...selected] : cursor >= 0 && msgs[cursor] ? [msgs[cursor].uid] : [];

      if (Date.now() - gPrefix.current < 1200) {
        gPrefix.current = 0;
        const dest = { i: sp.inbox, s: sp.sent, d: sp.drafts, t: sp.trash, a: sp.archive }[k.toLowerCase()];
        if (dest) {
          e.preventDefault();
          goFolder(dest);
        }
        return;
      }

      switch (k) {
        case "g":
          gPrefix.current = Date.now();
          break;
        case "c":
          e.preventDefault();
          openCompose(newCompose(settings.signature));
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "?":
          setModal("shortcuts");
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          step(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          step(-1);
          break;
        case "Enter":
        case "o":
          if (!openUid && cursor >= 0 && msgs[cursor]) openMessage(msgs[cursor], cursor);
          break;
        case "Escape":
          if (selected.size || allInFolder) {
            setSelected(new Set());
            setAllInFolder(false);
          } else if (openUid) closeReader();
          break;
        case "x":
          if (cursor >= 0 && msgs[cursor]) toggleSelect(msgs[cursor].uid, false);
          break;
        case "s":
          if (target.length) {
            const all = msgs.filter((m) => target.includes(m.uid)).every((m) => m.flagged);
            setFlag(target, "flagged", !all);
          }
          break;
        case "u":
          if (target.length) {
            setFlag(target, "seen", false);
            if (openUid) setOpenUid(null);
          }
          break;
        case "I":
          if (target.length) setFlag(target, "seen", true);
          break;
        case "e":
          if (target.length) archive(target);
          break;
        case "!":
          if (target.length) (isJunk ? notSpam : spam)(target);
          break;
        case "#":
        case "Delete":
          if (target.length) remove(target);
          break;
        case "v":
          if (target.length) {
            e.preventDefault(); // keep the "v" out of the menu's search box
            moveAnchor.current = searchRef.current;
            setMove({ uids: target });
          }
          break;
        case "r":
        case "a":
        case "f": {
          const m = latestRef.current;
          if (!openUid || !m) break;
          e.preventDefault();
          if (k === "f") openCompose(forwardCompose(m, settings.signature));
          else openCompose(replyCompose(m, k === "a" ? "replyAll" : "reply", email, settings.signature));
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compose, modal, move, folderDlg, openUid, selected, allInFolder, cursor, msgs, sp, isJunk, goFolder, openCompose, settings.signature, step, openMessage, toggleSelect, setFlag, archive, spam, notSpam, remove, email, closeReader]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const isSentLike = !!current && (current.special === "sent" || current.special === "drafts");

  const searchPlaceholder =
    scope === "all" ? t("topbar.searchAll") : current && current.special !== "inbox" ? t("topbar.searchIn", { folder: folderLabel(current, t) }) : t("topbar.searchMail");

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-bg">
      <TopBar
        className={openUid ? "max-md:hidden" : undefined}
        email={email}
        name={settings.name}
        query={query}
        onQuery={setQuery}
        onSearch={(q) => {
          setApplied(q);
          setPage(0);
          setOpenUid(null);
          setSelected(new Set());
          setAllInFolder(false);
        }}
        placeholder={searchPlaceholder}
        searchRef={searchRef}
        onMenu={openNav}
        theme={theme}
        onTheme={setTheme}
        onAppearance={() => setModal("appearance")}
        onSettings={() => setModal("settings")}
        onShortcuts={() => setModal("shortcuts")}
        onLogout={logout}
      />

      <div className="flex min-h-0 flex-1">
        {/* medium widths: navigation rail */}
        <div className="hidden md:flex xl:hidden">
          <NavRail
            folders={folders}
            current={folder}
            onSelect={goFolder}
            onCompose={() => openCompose(newCompose(settings.signature))}
            onMenu={openNav}
            onDropMessages={dropMessages}
          />
        </div>

        {/* navigation drawer: standard on wide screens, modal below */}
        <div
          className={cx(
            "fixed inset-y-0 start-0 z-50 w-[360px] max-w-[85vw] overflow-hidden rounded-e-2xl transition-transform duration-500 ease-emph",
            "xl:static xl:z-auto xl:w-[284px] xl:translate-x-0 xl:rtl:translate-x-0 xl:rounded-none xl:transition-none",
            navOpen ? "translate-x-0 shadow-e1" : "-translate-x-full rtl:translate-x-full",
          )}
          aria-hidden={!isXl && !navOpen ? true : undefined}
          inert={!isXl && !navOpen ? true : undefined}
        >
          <Sidebar
            folders={folders}
            current={folder}
            onSelect={goFolder}
            onCompose={() => openCompose(newCompose(settings.signature))}
            onDropMessages={dropMessages}
            onFolderAction={(kind, f) => {
              if (kind === "empty" || kind === "readAll") folderQuick(kind, f!);
              else setFolderDlg(kind === "create" ? { kind, parent: f } : { kind, folder: f! });
            }}
            modal={!isXl}
          />
        </div>
        {navOpen && !isXl && <div className="m3-scrim-in fixed inset-0 z-40 bg-scrim" onClick={closeNav} />}

        {/* content */}
        <main className="flex min-w-0 flex-1 gap-3 overflow-hidden md:pb-3 md:pe-3">
          <div
            className={cx(
              "h-full w-full shrink-0 overflow-hidden md:rounded-[24px] md:bg-panel lg:w-[400px] 2xl:w-[440px]",
              openUid ? "hidden lg:block" : "block",
            )}
          >
            <MessageList
              folder={current}
              list={list && list.folder === listFolder ? list : null}
              scope={scope}
              onScope={(s) => {
                setScope(s);
                setPage(0);
                setOpenUid(null);
                setSelected(new Set());
                setAllInFolder(false);
              }}
              folders={folders}
              allInFolder={allInFolder}
              onSelectFolder={setAllInFolder}
              canSelectFolder={!applied && filter === "all"}
              onRowAction={rowAction}
              onEmpty={(isTrash || isJunk) && current ? () => folderQuick("empty", current) : undefined}
              isJunk={isJunk}
              canSpam={!!sp.junk && !isJunk && !isTrash}
              loading={loading}
              refreshing={refreshing}
              error={listError}
              openUid={openUid}
              cursor={openIdx >= 0 ? openIdx : cursor}
              selected={selected}
              appliedQuery={applied}
              filter={filter}
              onFilter={(f) => {
                setFilter(f);
                setPage(0);
                setSelected(new Set());
              }}
              onOpen={openMessage}
              onToggleSelect={toggleSelect}
              onSelectAll={(on) => {
                setSelected(on ? new Set(msgs.map((m) => m.uid)) : new Set());
                setAllInFolder(false);
              }}
              onStar={(m) => setFlag([m.uid], "flagged", !m.flagged)}
              onBulk={bulk}
              onPage={(p) => {
                setPage(p);
                setSelected(new Set());
              }}
              onRefresh={() => {
                loadList(true);
                loadFolders();
              }}
              onClearSearch={() => {
                setQuery("");
                setApplied("");
                setScope("folder");
                setPage(0);
              }}
              canArchive={!!sp.archive && folder !== sp.archive}
              isSentLike={isSentLike}
              onScrollDir={setFabExtended}
            />
          </div>
          <div className={cx("h-full min-w-0 flex-1 overflow-hidden bg-panel md:rounded-[24px]", openUid ? "block" : "hidden lg:block")}>
            {openUid ? (
              <Reader
                key={`${folder}|${openUid}|${threadRev}`}
                folder={folder}
                uid={openUid}
                dark={dark}
                flagged={!!openMsg?.flagged}
                actions={readerActions}
                registerLatest={registerLatest}
                me={email}
                isJunk={isJunk}
              />
            ) : (
              <ReaderEmpty count={msgs.length} />
            )}
          </div>
        </main>
      </div>

      {/* phone compose button: collapses to an icon while scrolling down (M3 extended FAB) */}
      {!openUid && !compose && (
        <button
          type="button"
          onClick={() => openCompose(newCompose(settings.signature))}
          aria-label={t("app.newMessage")}
          className={cx(
            "sl m3-sheet-in fixed bottom-[calc(16px+env(safe-area-inset-bottom))] end-4 z-20 flex h-14 items-center rounded-2xl bg-accent-soft ps-4 type-label-large text-on-accent-soft shadow-e3 transition-[padding] duration-300 ease-emph md:hidden",
            fabExtended ? "pe-5" : "pe-4",
          )}
        >
          <Icon name="edit" />
          <span
            className={cx(
              "overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-300 ease-emph",
              fabExtended ? "ms-3 max-w-[120px] opacity-100" : "ms-0 max-w-0 opacity-0",
            )}
          >
            {t("app.newMessage")}
          </span>
        </button>
      )}

      {compose && (
        <Composer
          key={compose.key}
          init={compose}
          contacts={contacts}
          onClose={() => setCompose(null)}
          onQueue={queueSend}
          onError={fail}
          onDraftSaved={() => {
            if (folder === sp.drafts) loadList(true);
          }}
          onDiscarded={() => {
            toast({ text: t("app.draftDeleted") });
            if (folder === sp.drafts) loadList(true);
            loadFolders();
          }}
        />
      )}

      <MoveMenu
        anchor={moveAnchor}
        open={!!move}
        onClose={() => setMove(null)}
        folders={folders}
        current={folder}
        onPick={(to) => {
          const m = move;
          setMove(null);
          if (m?.all) bulkAll("move", to);
          else moveTo(m?.uids || [], to);
        }}
      />
      <SettingsDialog
        open={modal === "settings"}
        onClose={() => setModal(null)}
        settings={settings}
        onSaved={setSettings}
        email={email}
        notifyOn={notifyOn}
        onNotify={setNotify}
      />
      <FolderDialog
        state={folderDlg && folderDlg.kind !== "create" ? { ...folderDlg, folder: folders.find((f) => f.path === folderDlg.folder.path) || folderDlg.folder } : folderDlg}
        onClose={() => setFolderDlg(null)}
        onSubmit={folderOp}
      />
      <ShortcutsDialog open={modal === "shortcuts"} onClose={() => setModal(null)} />
      <AppearanceDialog open={modal === "appearance"} onClose={() => setModal(null)} theme={theme} onTheme={setTheme} dark={dark} />
      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
