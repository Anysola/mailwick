"use client";

import { useEffect, useRef, useState } from "react";
import { displayName, shortDate } from "@/lib/client";
import type { Folder, MessageList as List, MessageSummary } from "@/lib/types";
import { Avatar, Button, Checkbox, cx, FilterChip, Icon, IconButton, LinearProgress } from "./ui";
import { folderLabel, folderShortLabel } from "./Sidebar";
import { useT } from "@/i18n/client";

export type Filter = "all" | "unread" | "flagged";
export type Scope = "folder" | "all";
export type RowAction = "archive" | "delete" | "read" | "spam" | "notSpam";

type Props = {
  folder?: Folder;
  folders: Folder[];
  list: List | null;
  scope: Scope;
  onScope: (s: Scope) => void;
  /** every message in the folder is selected (beyond this page too) */
  allInFolder: boolean;
  onSelectFolder: (on: boolean) => void;
  canSelectFolder: boolean;
  onRowAction: (m: MessageSummary, a: RowAction) => void;
  /** in Trash/Junk: empty the folder */
  onEmpty?: () => void;
  isJunk: boolean;
  canSpam: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  openUid: number | null;
  cursor: number;
  selected: Set<number>;
  appliedQuery: string;
  onClearSearch: () => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (m: MessageSummary, i: number) => void;
  onToggleSelect: (uid: number, shift: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onStar: (m: MessageSummary) => void;
  onBulk: (action: "read" | "unread" | "star" | "delete" | "archive" | "spam" | "move", anchor?: HTMLElement) => void;
  onPage: (p: number) => void;
  onRefresh: () => void;
  /** false while scrolling down (shrinks the phone FAB) */
  onScrollDir?: (atTopOrUp: boolean) => void;
  canArchive: boolean;
  isSentLike: boolean;
};

export function MessageList(p: Props) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);
  const [scrolled, setScrolled] = useState(false);
  const msgs = p.list?.messages || [];
  const total = p.list?.total || 0;
  const from = total ? p.list!.page * p.list!.pageSize + 1 : 0;
  const to = p.list ? Math.min(total, from + msgs.length - 1) : 0;
  const allSelected = msgs.length > 0 && msgs.every((m) => p.selected.has(m.uid));
  const someSelected = p.selected.size > 0 || p.allInFolder;
  const searchingAll = p.scope === "all" && !!p.appliedQuery;
  const canSelect = !searchingAll; // no bulk selection in all-folder search (rows come from different folders)
  const labelOf = (path: string) => folderShortLabel(p.folders.find((f) => f.path === path), t) || path.split("/").pop() || path;

  // keep the keyboard cursor row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${p.cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [p.cursor]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
    p.onScrollDir?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.list?.folder, p.list?.page, p.appliedQuery, p.filter, p.scope]);

  return (
    <section className="flex h-full min-w-0 flex-col">
      {/* title + toolbar: switches to the M3 "scrolled" surface when the list scrolls */}
      <div className={cx("shrink-0 transition-colors duration-200 ease-std", scrolled && "bg-panel-2 dark:bg-surface-high")}>
        <header className="flex h-16 items-center gap-1 ps-5 pe-2 md:pt-1">
          {p.appliedQuery ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <h1 className="shrink-0 type-title-large">{t("list.search")}</h1>
              <button
                type="button"
                onClick={p.onClearSearch}
                data-tip={t("topbar.clearSearch")}
                className="sl flex h-8 min-w-0 items-center gap-2 rounded-lg bg-select ps-3 pe-2 type-label-large text-on-select"
              >
                <span className="truncate" dir="auto">“{p.appliedQuery}”</span>
                <Icon name="close" size={18} />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-baseline gap-3">
              <h1 className="truncate type-title-large">{folderLabel(p.folder, t)}</h1>
              {p.folder && p.folder.unseen > 0 && <span className="shrink-0 type-body-medium text-muted tabular-nums">{t("list.unreadCount", { count: p.folder.unseen })}</span>}
            </div>
          )}
          {!!p.list && total > p.list.pageSize && (
            <div className="flex shrink-0 items-center type-body-small text-muted tabular-nums">
              <span className="me-1 hidden sm:inline">{from}–{to} / {total}</span>
              <IconButton label={t("list.prevPage")} disabled={p.list.page === 0} onClick={() => p.onPage(p.list!.page - 1)}>
                <Icon name="chevron_left" />
              </IconButton>
              <IconButton label={t("list.nextPage")} disabled={to >= total} onClick={() => p.onPage(p.list!.page + 1)}>
                <Icon name="chevron_right" />
              </IconButton>
            </div>
          )}
          {p.onEmpty && !p.appliedQuery && total > 0 && (
            <IconButton label={t("folders.empty", { folder: folderLabel(p.folder, t) })} onClick={p.onEmpty} className="hover:!text-danger">
              <Icon name="delete_sweep" />
            </IconButton>
          )}
          <IconButton label={t("list.refresh")} onClick={p.onRefresh} disabled={p.refreshing}>
            <Icon name="refresh" className={cx(p.refreshing && "animate-spin")} />
          </IconButton>
        </header>

        {/* filters or bulk actions */}
        <div className="flex min-h-12 items-center gap-1 pb-2 ps-2 pe-2">
          {canSelect && (
            <Checkbox
              label={t("list.selectAll")}
              checked={allSelected || p.allInFolder}
              indeterminate={!allSelected && !p.allInFolder && someSelected}
              disabled={!msgs.length}
              onChange={(v) => p.onSelectAll(v)}
            />
          )}
          {someSelected ? (
            <div className="flex min-w-0 flex-1 items-center gap-0.5 animate-fade">
              <span className="me-1 shrink-0 whitespace-nowrap type-title-small text-fg tabular-nums">{t("list.selected", { count: p.allInFolder ? total : p.selected.size })}</span>
              <div className="ms-auto flex shrink-0 items-center overflow-x-auto">
                <IconButton label={t("list.markRead")} onClick={() => p.onBulk("read")}><Icon name="mark_email_read" /></IconButton>
                <IconButton label={t("list.markUnread")} onClick={() => p.onBulk("unread")}><Icon name="mark_email_unread" /></IconButton>
                <IconButton label={t("list.star")} onClick={() => p.onBulk("star")}><Icon name="star" /></IconButton>
                {p.canArchive && <IconButton label={t("list.archive")} onClick={() => p.onBulk("archive")}><Icon name="archive" /></IconButton>}
                {p.canSpam && <IconButton label={t("list.spam")} onClick={() => p.onBulk("spam")}><Icon name="report" /></IconButton>}
                <IconButton label={t("list.move")} onClick={(e) => p.onBulk("move", e.currentTarget)}><Icon name="drive_file_move" /></IconButton>
                <IconButton label={t("list.delete")} onClick={() => p.onBulk("delete")} className="hover:!text-danger"><Icon name="delete" /></IconButton>
              </div>
            </div>
          ) : p.appliedQuery ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              <FilterChip selected={p.scope === "folder"} onClick={() => p.onScope("folder")} icon="folder">{folderLabel(p.folder, t) || t("list.thisFolder")}</FilterChip>
              <FilterChip selected={p.scope === "all"} onClick={() => p.onScope("all")} icon="stacks">{t("list.allFolders")}</FilterChip>
              <span className="flex-1" />
              <FilterChip selected={p.filter === "unread"} onClick={() => p.onFilter(p.filter === "unread" ? "all" : "unread")} icon="mark_email_unread">{t("list.unread")}</FilterChip>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              <FilterChip selected={p.filter === "all"} onClick={() => p.onFilter("all")}>{t("list.all")}</FilterChip>
              <FilterChip selected={p.filter === "unread"} onClick={() => p.onFilter("unread")} icon="mark_email_unread">{t("list.unread")}</FilterChip>
              <FilterChip selected={p.filter === "flagged"} onClick={() => p.onFilter("flagged")} icon="star">{t("list.starred")}</FilterChip>
            </div>
          )}
        </div>

        {/* everything on the page is selected: offer to select the whole folder */}
        {allSelected && p.canSelectFolder && total > msgs.length && (
          <div className="mx-4 mb-2 flex min-h-10 flex-wrap items-center justify-center gap-x-2 gap-y-0 rounded-xl bg-panel-2 px-3 py-1 text-center type-body-medium text-muted animate-fade dark:bg-surface-high">
            {p.allInFolder ? (
              <>
                <span>{t("list.allInFolderSelected", { count: total, folder: folderLabel(p.folder, t) })}</span>
                <button type="button" onClick={() => p.onSelectFolder(false)} className="sl rounded-full px-2 py-1 type-label-large text-accent">{t("list.clearSelection")}</button>
              </>
            ) : (
              <>
                <span>{t("list.pageSelected", { count: msgs.length })}</span>
                <button type="button" onClick={() => p.onSelectFolder(true)} className="sl rounded-full px-2 py-1 type-label-large text-accent">{t("list.selectAllInFolder", { count: total })}</button>
              </>
            )}
          </div>
        )}
        {searchingAll && p.list?.truncated && !p.loading && (
          <div className="mx-4 mb-2 rounded-xl bg-panel-2 px-3 py-2 text-center type-body-small text-muted dark:bg-surface-high">
            {t("list.truncatedBefore")} <code className="font-mono" dir="ltr">from:</code> {t("list.truncatedOr")} <code className="font-mono" dir="ltr">after:2026-01-01</code>.
          </div>
        )}
      </div>

      {/* thin progress bar while the folder/page changes */}
      <div className="relative h-0">
        {p.loading && msgs.length > 0 && <LinearProgress className="absolute inset-x-4 -top-1 animate-fade" />}
      </div>

      {/* list */}
      <div
        ref={listRef}
        onScroll={(e) => {
          const y = e.currentTarget.scrollTop;
          setScrolled(y > 4);
          if (Math.abs(y - lastY.current) > 6) {
            p.onScrollDir?.(y < 24 || y < lastY.current);
            lastY.current = y;
          }
        }}
        className="relative flex-1 overflow-y-auto overscroll-contain"
      >
        {p.loading && !msgs.length ? (
          <ListSkeleton />
        ) : p.error ? (
          <Empty icon="cloud_off" title={t("list.loadFailed")} text={p.error} />
        ) : !msgs.length ? (
          p.appliedQuery ? (
            <Empty
              icon="search_off"
              title={t("list.noResults")}
              text={t(searchingAll ? "list.noResultsAll" : "list.noResultsFolder", { query: p.appliedQuery })}
              action={!searchingAll ? { label: t("list.searchAllFolders"), run: () => p.onScope("all") } : undefined}
            />
          ) : p.filter !== "all" ? (
            <Empty icon="done_all" title={p.filter === "unread" ? t("list.noUnread") : t("list.noStarred")} text={t("list.allDone")} />
          ) : (
            <Empty icon="inbox" title={t("list.emptyFolder")} text={t("list.emptyFolderText")} />
          )
        ) : (
          <ul role="list" className={cx("space-y-0.5 px-2 pb-28 transition-opacity md:pb-2", p.loading && "opacity-60")}>
            {msgs.map((m, i) => (
              <Row
                key={m.uid}
                m={m}
                index={i}
                active={m.uid === p.openUid}
                cursor={i === p.cursor}
                selected={canSelect && (p.selected.has(m.uid) || p.allInFolder)}
                selectMode={canSelect && someSelected}
                canSelect={canSelect}
                sentLike={p.isSentLike && !searchingAll}
                onOpen={() => p.onOpen(m, i)}
                onSelect={(shift) => canSelect && p.onToggleSelect(m.uid, shift)}
                onStar={() => p.onStar(m)}
                onAction={(a) => p.onRowAction(m, a)}
                canArchive={p.canArchive}
                canSpam={p.canSpam}
                isJunk={p.isJunk}
                dragUids={p.selected.has(m.uid) ? [...p.selected] : [m.uid]}
                folder={m.folder || p.list!.folder}
                folderTag={searchingAll && m.folder ? labelOf(m.folder) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({
  m, index, active, cursor, selected, selectMode, canSelect, sentLike, onOpen, onSelect, onStar, onAction, canArchive, canSpam, isJunk, dragUids, folder, folderTag,
}: {
  m: MessageSummary;
  index: number;
  active: boolean;
  cursor: boolean;
  selected: boolean;
  selectMode: boolean;
  canSelect: boolean;
  sentLike: boolean;
  onOpen: () => void;
  onSelect: (shift: boolean) => void;
  onStar: () => void;
  onAction: (a: RowAction) => void;
  canArchive: boolean;
  canSpam: boolean;
  isJunk: boolean;
  dragUids: number[];
  folder: string;
  folderTag?: string;
}) {
  const t = useT();
  const who = sentLike ? m.to : m.from;
  const whoText = sentLike
    ? m.to.length
      ? t("list.toLine", { names: m.to.map((a) => displayName(a)).join(", ") })
      : t("list.noRecipient")
    : who.map((a) => displayName(a)).join(", ") || t("list.noSender");
  const unread = !m.seen && !m.draft;

  return (
    <li
      data-index={index}
      draggable={canSelect}
      onDragStart={(e) => {
        if (!canSelect) return e.preventDefault();
        e.dataTransfer.setData("application/x-mailwick", JSON.stringify({ folder, uids: dragUids }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        if (canSelect && (e.metaKey || e.ctrlKey || e.shiftKey)) onSelect(e.shiftKey);
        else onOpen();
      }}
      aria-current={active || undefined}
      className={cx(
        "sl group flex cursor-default select-none gap-4 rounded-2xl py-3 ps-4 pe-3 compact:py-2",
        active ? "bg-select text-on-select" : selected ? "bg-accent-soft/60 text-fg" : "text-fg",
        cursor && !active && "ring-2 ring-inset ring-accent/60",
      )}
    >
      <div
        className="relative h-10 w-10 shrink-0 compact:h-8 compact:w-8"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(e.shiftKey);
        }}
      >
        <div className={cx("transition duration-200 ease-std", selected || selectMode ? "scale-75 opacity-0" : canSelect && "group-hover:scale-75 group-hover:opacity-0")}>
          <Avatar addr={who[0]} size={40} className="compact:!h-8 compact:!w-8 compact:!text-[13px]" />
        </div>
        <div
          className={cx(
            "absolute inset-0 grid place-items-center transition duration-200 ease-std",
            selected || selectMode ? "opacity-100" : cx("opacity-0", canSelect && "group-hover:opacity-100"),
          )}
        >
          <span
            className={cx(
              "grid h-[18px] w-[18px] place-items-center rounded-[2px] border-2 transition-colors",
              selected ? "border-accent bg-accent text-accent-fg" : "border-muted",
            )}
          >
            {selected && <Icon name="check" size={16} weight={700} />}
          </span>
        </div>
      </div>

      <div className="relative min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span dir="auto" className={cx("min-w-0 flex-1 truncate text-left rtl:text-right type-body-large", unread && "!font-bold")}>
            {m.draft && <span className="me-1 text-danger">{t("list.draft")}</span>}
            {whoText}
          </span>
          {folderTag && (
            <span className={cx("shrink-0 rounded-md px-1.5 py-px type-label-small", active ? "bg-on-select/10" : "bg-panel-2 text-muted dark:bg-surface-high")}>{folderTag}</span>
          )}
          <span className={cx("shrink-0 type-label-medium tabular-nums md:group-hover:invisible", unread ? "!font-bold text-accent" : "text-muted")}>{shortDate(m.date)}</span>
        </div>
        {/* quick actions on hover (pointer devices only) */}
        {!selectMode && (
          <div
            className={cx(
              "absolute -end-1 -top-2 hidden items-center rounded-full md:group-hover:flex md:group-focus-within:flex",
              active ? "bg-select" : "bg-panel",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {canArchive && <IconButton label={t("list.archive")} size="sm" onClick={() => onAction("archive")}><Icon name="archive" size={20} /></IconButton>}
            <IconButton label={t("list.delete")} size="sm" onClick={() => onAction("delete")} className="hover:!text-danger"><Icon name="delete" size={20} /></IconButton>
            {!m.draft && (
              <IconButton label={m.seen ? t("list.markUnread") : t("list.markRead")} size="sm" onClick={() => onAction("read")}>
                <Icon name={m.seen ? "mark_email_unread" : "mark_email_read"} size={20} />
              </IconButton>
            )}
            {isJunk ? (
              <IconButton label={t("list.notSpam")} size="sm" onClick={() => onAction("notSpam")}><Icon name="report_off" size={20} /></IconButton>
            ) : (
              canSpam && <IconButton label={t("list.spam")} size="sm" onClick={() => onAction("spam")}><Icon name="report" size={20} /></IconButton>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {m.answered && <Icon name="reply" size={16} className="text-muted" />}
          <span dir="auto" className={cx("min-w-0 flex-1 truncate text-left rtl:text-right type-body-medium", unread && "!font-bold")}>
            {m.subject || <span className="italic text-muted">{t("common.noSubject")}</span>}
          </span>
          {m.attachments && <Icon name="attach_file" size={18} className="text-muted" />}
          <button
            type="button"
            aria-pressed={m.flagged}
            aria-label={m.flagged ? t("list.unstar") : t("list.star")}
            onClick={(e) => {
              e.stopPropagation();
              onStar();
            }}
            className={cx(
              "sl -my-2 -me-2 grid h-10 w-10 shrink-0 place-items-center rounded-full transition-opacity",
              m.flagged ? "text-star" : "text-muted md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            )}
          >
            <Icon name="star" size={20} fill={m.flagged} />
          </button>
        </div>
        <p dir="auto" className={cx("truncate text-left rtl:text-right type-body-medium compact:hidden", active ? "opacity-80" : "text-muted")}>{m.snippet || " "}</p>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="px-2">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3.5 ps-4 pe-3">
          <div className="skeleton h-10 w-10 !rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="flex justify-between gap-6">
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-3 w-10" />
            </div>
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-3 w-11/12 opacity-70" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ title, text, icon, action }: { title: string; text: string; icon: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-accent-soft text-on-accent-soft">
        <Icon name={icon} size={36} />
      </div>
      <div className="type-title-medium">{title}</div>
      <div className="mt-1 max-w-[280px] type-body-medium text-muted">{text}</div>
      {action && <Button variant="tonal" className="mt-4" icon="stacks" onClick={action.run}>{action.label}</Button>}
    </div>
  );
}
