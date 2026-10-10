"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, cx, Icon, IconButton, Kbd, MenuDivider, MenuItem, Popover, Segmented, Spinner } from "./ui";
import { Logo } from "./Logo";
import type { Theme } from "./Sidebar";
import { useBrand, useLocale, useT } from "@/i18n/client";

type Props = {
  email: string;
  name: string;
  query: string;
  onQuery: (q: string) => void;
  onSearch: (q: string) => void;
  placeholder: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onMenu: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onAppearance: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onLogout: () => void;
  className?: string;
};

const RECENT_KEY = "mw-recent-search";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
}

export function TopBar(p: Props) {
  const t = useT();
  const locale = useLocale();
  const brand = useBrand();
  const acctDesk = useRef<HTMLButtonElement>(null);
  const acctMobile = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(false); // M3 search view (recent searches)
  const [recent, setRecent] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLFormElement>(null);
  const me = { address: p.email, name: p.name };

  useEffect(() => setRecent(readRecent()), []);
  useEffect(() => setHi(-1), [open, p.query]);

  const openMenu = (el: HTMLElement | null) => {
    anchor.current = el;
    setMenu((v) => !v);
  };

  const shown = recent.filter((r) => !p.query || r.toLocaleLowerCase(locale).includes(p.query.toLocaleLowerCase(locale)));
  // operator hints while empty, matching recent searches while typing
  const viewOpen = open && (shown.length > 0 || !p.query);
  const addOp = (op: string) => {
    const q = p.query.trim();
    p.onQuery(q ? `${q} ${op}` : op);
    p.searchRef.current?.focus();
  };

  const run = (q: string) => {
    const v = q.trim();
    p.onQuery(v);
    p.onSearch(v);
    if (v) {
      const next = [v, ...recent.filter((r) => r !== v)];
      setRecent(next);
      saveRecent(next);
    }
    setOpen(false);
    p.searchRef.current?.blur();
  };

  return (
    <header className={cx("relative z-30 flex h-16 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-3 xl:px-4", p.className)}>
      <div className="hidden w-[248px] shrink-0 items-center gap-3 ps-2 xl:flex">
        <Logo size={36} />
        <span className="type-title-large">{brand.name}</span>
      </div>

      <div className="relative min-w-0 flex-1 md:max-w-[720px]">
        <form
          ref={box}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            run(hi >= 0 && shown[hi] ? shown[hi] : p.query);
          }}
          className={cx(
            "relative z-10 flex h-14 items-center gap-1 bg-surface-high ps-1 pe-1 transition-[border-radius,background-color,box-shadow] duration-200 ease-std md:ps-4",
            viewOpen ? "rounded-t-[28px] bg-surface-high shadow-e3" : "rounded-[28px] focus-within:shadow-e1",
          )}
        >
          <IconButton label={t("topbar.menu")} className="md:hidden" onClick={p.onMenu}>
            <Icon name="menu" />
          </IconButton>
          <Icon name="search" className="hidden text-muted md:block" />
          <input
            ref={p.searchRef}
            value={p.query}
            onChange={(e) => {
              p.onQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                if (viewOpen) setOpen(false);
                else if (p.query) {
                  p.onQuery("");
                  p.onSearch("");
                } else (e.target as HTMLInputElement).blur();
              } else if (viewOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                // -1 = the typed text; up/down cycles through the suggestions
                setHi((h) => {
                  const n = h + (e.key === "ArrowDown" ? 1 : -1);
                  return n >= shown.length ? -1 : n < -1 ? shown.length - 1 : n;
                });
              }
            }}
            placeholder={p.placeholder}
            aria-label={p.placeholder}
            aria-expanded={viewOpen}
            aria-controls="search-view"
            role="combobox"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent px-2 type-body-large text-fg outline-none placeholder:text-muted md:px-4"
          />
          {p.query ? (
            <IconButton label={t("topbar.clearSearch")} onClick={() => { p.onQuery(""); p.onSearch(""); p.searchRef.current?.focus(); }}>
              <Icon name="close" />
            </IconButton>
          ) : (
            <span className="me-3 hidden md:inline-flex"><Kbd>/</Kbd></span>
          )}
          <button
            ref={acctMobile}
            type="button"
            onClick={() => openMenu(acctMobile.current)}
            aria-label={t("topbar.account")}
            className="sl grid h-12 w-12 shrink-0 place-items-center rounded-full md:hidden"
          >
            <Avatar addr={me} size={32} />
          </button>
        </form>

        {viewOpen && (
          <div
            id="search-view"
            role="listbox"
            aria-label={t("topbar.recentSearches")}
            className="m3-menu-in absolute inset-x-0 top-full z-10 overflow-hidden rounded-b-[28px] bg-surface-high pb-2 shadow-e3"
          >
            <div className="mx-4 h-px bg-line" />
            {!p.query && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pb-1 pt-3 md:px-6">
                <span className="me-1 type-label-medium text-muted">{t("topbar.narrow")}</span>
                {["from:", "to:", "subject:", "has:attachment", "is:unread", "after:2026-01-01", "before:"].map((op) => (
                  <button
                    key={op}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addOp(op)}
                    className="sl h-7 rounded-lg border border-faint px-2.5 font-mono text-[12px] text-fg-2"
                  >
                    {op}
                  </button>
                ))}
              </div>
            )}
            {shown.length > 0 && (
            <div className="flex h-10 items-center justify-between ps-4 pe-2 md:ps-6">
              <span className="type-title-small text-muted">{t("topbar.recentSearches")}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setRecent([]);
                  saveRecent([]);
                }}
                className="sl rounded-full px-3 py-1 type-label-large text-accent"
              >
                {t("topbar.clear")}
              </button>
            </div>
            )}
            {shown.map((r, i) => (
              <div key={r} role="option" aria-selected={i === hi} className={cx("group flex items-center", i === hi && "bg-hover")}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(r)}
                  className="sl flex h-14 min-w-0 flex-1 items-center gap-4 ps-4 text-left type-body-large text-fg md:ps-6"
                >
                  <Icon name="history" className="text-muted" />
                  <span className="truncate">{r}</span>
                </button>
                <IconButton
                  label={t("topbar.removeFromList")}
                  size="sm"
                  className="me-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const next = recent.filter((x) => x !== r);
                    setRecent(next);
                    saveRecent(next);
                  }}
                >
                  <Icon name="close" size={20} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hidden flex-1 md:block" />
      <button
        ref={acctDesk}
        type="button"
        onClick={() => openMenu(acctDesk.current)}
        aria-label={t("topbar.account")}
        data-tip={`${p.name} · ${p.email}`}
        className="sl hidden h-12 w-12 shrink-0 place-items-center rounded-full md:grid"
      >
        <Avatar addr={me} size={40} />
      </button>

      <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} align="end" className="w-[320px] !rounded-[28px] !py-3">
        <div className="flex flex-col items-center gap-2 px-4 pb-3 pt-2 text-center">
          <Avatar addr={me} size={64} />
          <div className="min-w-0">
            <div className="truncate type-title-medium">{t("topbar.hello", { name: p.name.split(" ")[0] })}</div>
            <div className="truncate type-body-medium text-muted">{p.email}</div>
          </div>
        </div>
        <div className="px-4 pb-3">
          <Segmented<Theme>
            label={t("topbar.theme")}
            value={p.theme}
            onChange={p.onTheme}
            options={[
              { value: "light", label: t("topbar.light"), icon: "light_mode" },
              { value: "dark", label: t("topbar.dark"), icon: "dark_mode" },
              { value: "system", label: t("topbar.system"), icon: "brightness_auto" },
            ]}
          />
        </div>
        <MenuDivider />
        <MenuItem icon={<Icon name="palette" />} onClick={() => { setMenu(false); p.onAppearance(); }}>{t("topbar.appearance")}</MenuItem>
        <MenuItem icon={<Icon name="settings" />} onClick={() => { setMenu(false); p.onSettings(); }}>{t("topbar.settings")}</MenuItem>
        <MenuItem icon={<Icon name="keyboard" />} hint={<Kbd>?</Kbd>} onClick={() => { setMenu(false); p.onShortcuts(); }}>{t("topbar.shortcuts")}</MenuItem>
        <MenuDivider />
        <MenuItem
          icon={leaving ? <Spinner className="h-5 w-5" /> : <Icon name="logout" />}
          danger
          onClick={() => {
            if (leaving) return;
            setLeaving(true);
            p.onLogout();
          }}
        >
          {leaving ? t("topbar.signingOut") : t("topbar.signOut")}
        </MenuItem>
      </Popover>
    </header>
  );
}
