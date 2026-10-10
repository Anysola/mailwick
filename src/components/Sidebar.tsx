"use client";

import { useRef, useState } from "react";
import type { Folder } from "@/lib/types";
import { Badge, cx, Icon, IconButton, MenuDivider, MenuItem, Popover } from "./ui";
import { Logo } from "./Logo";
import { useBrand, useT } from "@/i18n/client";
import type { TFunction } from "@/i18n/format";

const SPECIAL_KEYS = ["inbox", "sent", "drafts", "trash", "junk", "archive", "flagged", "all"] as const;
type SpecialKey = (typeof SPECIAL_KEYS)[number];
const isSpecial = (v?: string): v is SpecialKey => !!v && (SPECIAL_KEYS as readonly string[]).includes(v);

const GLYPH: Record<string, string> = {
  inbox: "inbox",
  sent: "send",
  drafts: "draft",
  trash: "delete",
  junk: "report",
  archive: "archive",
  flagged: "star",
  all: "stacks",
};

/** Display name: translated for special folders, the server's name otherwise. */
export function folderLabel(f: Folder | undefined, t: TFunction) {
  if (!f) return "";
  return isSpecial(f.special) ? t(`folders.${f.special}`) : f.name;
}

export function folderShortLabel(f: Folder | undefined, t: TFunction) {
  if (!f) return "";
  return isSpecial(f.special) ? t(`folders.short.${f.special}`) : f.name;
}

/** Folder icon; filled when selected (M3). */
export function FolderGlyph({ f, size = 24, active, className }: { f: Folder; size?: number; active?: boolean; className?: string }) {
  return <Icon name={(f.special && GLYPH[f.special]) || "folder"} size={size} fill={active} className={className} />;
}

export type Theme = "light" | "dark" | "system";

function folderCount(f: Folder) {
  return f.special === "drafts" ? f.total : f.special === "sent" || f.special === "trash" ? 0 : f.unseen;
}

function useDrop(onDropMessages: (to: string, data: string) => void) {
  const [dropOn, setDropOn] = useState<string | null>(null);
  const bind = (path: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-mailwick")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropOn(path);
    },
    onDragLeave: () => setDropOn((d) => (d === path ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropOn(null);
      const data = e.dataTransfer.getData("application/x-mailwick");
      if (data) onDropMessages(path, data);
    },
  });
  return { dropOn, bind };
}

/** Navigation drawer (standard on wide screens, modal on narrow ones). */
export function Sidebar({
  folders,
  current,
  onSelect,
  onCompose,
  onDropMessages,
  onFolderAction,
  modal,
}: {
  folders: Folder[];
  current: string;
  onSelect: (path: string) => void;
  onCompose: () => void;
  onDropMessages: (to: string, data: string) => void;
  onFolderAction: (kind: "create" | "rename" | "delete" | "empty" | "readAll", f?: Folder) => void;
  modal?: boolean;
}) {
  const t = useT();
  const brand = useBrand();
  const { dropOn, bind } = useDrop(onDropMessages);
  const folderAnchor = useRef<HTMLElement | null>(null);
  const [folderMenu, setFolderMenu] = useState<Folder | null>(null);
  const openFolderMenu = (f: Folder, el: HTMLElement) => {
    folderAnchor.current = el;
    setFolderMenu(f);
  };
  const specials = folders.filter((f) => f.special);
  const others = folders.filter((f) => !f.special);

  const row = (f: Folder) => {
    const active = f.path === current;
    const count = folderCount(f);
    return (
      <div key={f.path} className="group/row relative">
        <button
          type="button"
          onClick={() => onSelect(f.path)}
          aria-current={active ? "page" : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            openFolderMenu(f, e.currentTarget);
          }}
          {...bind(f.path)}
          className={cx(
            "sl flex h-14 w-full items-center gap-3 rounded-full pe-6 type-label-large transition-colors duration-200 compact:h-12",
            active ? "bg-select text-on-select" : "text-muted",
            dropOn === f.path && "bg-accent-soft text-on-accent-soft ring-2 ring-accent",
            "pe-12",
          )}
          style={{ paddingInlineStart: 16 + Math.min(f.depth, 4) * 16 }}
        >
          <FolderGlyph f={f} active={active} />
          <span className={cx("flex-1 truncate text-left", active && "font-bold")}>{folderLabel(f, t)}</span>
          {count > 0 && (
            <span className={cx("tabular-nums", active && "font-bold", "group-hover/row:invisible")}>{count > 999 ? "999+" : count}</span>
          )}
        </button>
        {(
          <IconButton
            label={t("folders.options", { folder: folderLabel(f, t) })}
            size="sm"
            onClick={(e) => openFolderMenu(f, e.currentTarget)}
            className={cx(
              "absolute end-3 top-1/2 -translate-y-1/2",
              folderMenu?.path === f.path ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
            )}
          >
            <Icon name="more_vert" size={20} />
          </IconButton>
        )}
      </div>
    );
  };

  return (
    <aside className={cx("flex h-full w-full flex-col", modal ? "bg-panel-2 dark:bg-panel" : "bg-bg")} aria-label={t("folders.folders")}>
      <div className={cx("flex h-16 shrink-0 items-center gap-3 px-7", !modal && "xl:hidden")}>
        <Logo size={32} />
        <span className="type-title-large">{brand.name}</span>
      </div>

      {!modal && (
        <div className="px-3 pb-4 pt-1 xl:pt-2">
          <button
            type="button"
            onClick={onCompose}
            data-tip={t("app.newMessageKey")}
            className="sl flex h-14 items-center gap-3 rounded-2xl bg-accent-soft ps-4 pe-5 type-label-large text-on-accent-soft shadow-e3 transition-shadow duration-200 hover:shadow-e4"
          >
            <Icon name="edit" />
            {t("app.newMessage")}
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div>{specials.map(row)}</div>
        {folders.length > 0 && (
          <>
            <div className="mx-4 my-2 h-px bg-line" />
            <div className="flex h-14 items-center justify-between ps-4 pe-2">
              <span className="type-title-small text-muted">{t("folders.folders")}</span>
              <IconButton label={t("folders.newFolder")} onClick={() => onFolderAction("create")}>
                <Icon name="add" />
              </IconButton>
            </div>
            <div>{others.map(row)}</div>
            {!others.length && (
              <button
                type="button"
                onClick={() => onFolderAction("create")}
                className="sl flex h-14 w-full items-center gap-3 rounded-full px-4 type-label-large text-muted"
              >
                <Icon name="create_new_folder" /> {t("folders.createFolder")}
              </button>
            )}
          </>
        )}
        {!folders.length &&
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton mx-4 my-[19px] h-[18px]" style={{ width: `${70 - i * 6}%` }} />)}
        <Popover anchor={folderAnchor} open={!!folderMenu} onClose={() => setFolderMenu(null)} className="w-[220px]">
          {folderMenu && (
            <>
              <MenuItem icon={<Icon name="mark_email_read" />} disabled={!folderMenu.unseen} onClick={() => { setFolderMenu(null); onFolderAction("readAll", folderMenu); }}>{t("folders.markAllRead")}</MenuItem>
              {(folderMenu.special === "trash" || folderMenu.special === "junk") && (
                <MenuItem icon={<Icon name="delete_sweep" />} danger disabled={!folderMenu.total} onClick={() => { setFolderMenu(null); onFolderAction("empty", folderMenu); }}>
                  {t("folders.empty", { folder: folderLabel(folderMenu, t) })}
                </MenuItem>
              )}
              {!folderMenu.special && (
                <>
                  <MenuDivider />
                  <MenuItem icon={<Icon name="create_new_folder" />} onClick={() => { setFolderMenu(null); onFolderAction("create", folderMenu); }}>{t("folders.createSubfolder")}</MenuItem>
                  <MenuItem icon={<Icon name="edit" />} onClick={() => { setFolderMenu(null); onFolderAction("rename", folderMenu); }}>{t("folders.rename")}</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<Icon name="delete" />} danger onClick={() => { setFolderMenu(null); onFolderAction("delete", folderMenu); }}>{t("folders.deleteFolder")}</MenuItem>
                </>
              )}
            </>
          )}
        </Popover>
      </nav>
    </aside>
  );
}

/** M3 navigation rail (medium widths): menu, FAB and up to 7 destinations. */
export function NavRail({
  folders,
  current,
  onSelect,
  onCompose,
  onMenu,
  onDropMessages,
}: {
  folders: Folder[];
  current: string;
  onSelect: (path: string) => void;
  onCompose: () => void;
  onMenu: () => void;
  onDropMessages: (to: string, data: string) => void;
}) {
  const t = useT();
  const { dropOn, bind } = useDrop(onDropMessages);
  const items = folders.filter((f) => f.special && f.special !== "all").slice(0, 6);
  const currentIsCustom = !folders.find((f) => f.path === current)?.special;
  return (
    <nav aria-label={t("folders.folders")} className="flex h-full w-20 shrink-0 flex-col items-center gap-1 pb-4 pt-1">
      <IconButton label={t("folders.allFolders")} onClick={onMenu} className="mb-1">
        <Icon name="menu" />
      </IconButton>
      <button
        type="button"
        onClick={onCompose}
        aria-label={t("app.newMessage")}
        data-tip={t("app.newMessageKey")}
        className="sl mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-on-accent-soft shadow-e3 transition-shadow duration-200 hover:shadow-e4"
      >
        <Icon name="edit" />
      </button>
      {items.map((f) => {
        const active = f.path === current;
        const count = folderCount(f);
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            aria-current={active ? "page" : undefined}
            aria-label={folderLabel(f, t)}
            {...bind(f.path)}
            className="group flex w-full flex-col items-center gap-1 pb-1.5 pt-0.5"
          >
            <span
              className={cx(
                "sl relative grid h-8 w-14 place-items-center rounded-full transition-colors duration-200",
                active ? "bg-select text-on-select" : "text-muted",
                dropOn === f.path && "ring-2 ring-accent",
              )}
            >
              <FolderGlyph f={f} active={active} />
              {count > 0 && <Badge n={f.special === "inbox" ? count : undefined} className={cx("absolute", f.special === "inbox" ? "start-[30px] top-0" : "start-[34px] top-1")} />}
            </span>
            <span className={cx("max-w-full truncate px-1 type-label-medium", active ? "text-fg" : "text-muted")}>{folderShortLabel(f, t)}</span>
          </button>
        );
      })}
      {currentIsCustom && folders.length > 0 && (
        <button type="button" onClick={onMenu} className="group flex w-full flex-col items-center gap-1 pb-1.5 pt-0.5" aria-label={t("folders.folders")}>
          <span className="relative grid h-8 w-14 place-items-center rounded-full bg-select text-on-select">
            <Icon name="folder" fill />
          </span>
          <span className="max-w-full truncate px-1 type-label-medium text-fg">{t("folders.folder")}</span>
        </button>
      )}
    </nav>
  );
}
