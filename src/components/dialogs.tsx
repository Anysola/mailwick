"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, isMac } from "@/lib/client";
import { UNDO_CHOICES, type Folder, type Settings } from "@/lib/types";
import { applyAppearance, readAppearance, SEEDS, swatch, type Appearance, type Contrast, type Density, type Variant } from "@/lib/theme";
import { Button, cx, Icon, IconButton, Kbd, Modal, Popover, Segmented, Spinner, TextField, Toggle } from "./ui";
import { folderLabel, FolderGlyph, type Theme } from "./Sidebar";
import { rich, setLocale, useLocale, useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/format";
import { LOCALES, LOCALE_COOKIE } from "@/i18n/locales";

// ---------- settings ----------

function SettingRow({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4">
      <div className="min-w-[200px] flex-1">
        <div className="type-title-medium">{title}</div>
        <div className="mt-0.5 type-body-medium text-muted">{text}</div>
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  onSaved,
  email,
  notifyOn,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onSaved: (s: Settings) => void;
  email: string;
  notifyOn: boolean;
  onNotify: (on: boolean) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const [lang, setLang] = useState("auto");
  const [name, setName] = useState(settings.name);
  const [loadImages, setLoadImages] = useState(settings.loadImages);
  const [undoSeconds, setUndoSeconds] = useState(settings.undoSeconds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sigFocus, setSigFocus] = useState(false);
  const sig = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(settings.name);
    setLoadImages(settings.loadImages);
    setUndoSeconds(settings.undoSeconds);
    setErr("");
    setLang(document.cookie.split("; ").some((c) => c.startsWith(`${LOCALE_COOKIE}=`)) ? locale : "auto");
    requestAnimationFrame(() => {
      if (sig.current) sig.current.innerHTML = settings.signature;
    });
  }, [open, settings, locale]);

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const s = await api<Settings>("/api/settings", {
        method: "POST",
        json: { name, signature: sig.current?.innerHTML.replace(/^(<br>|<div><br><\/div>)+$/, "") || "", loadImages, undoSeconds },
      });
      onSaved(s);
      const hasCookie = document.cookie.split("; ").some((c) => c.startsWith(`${LOCALE_COOKIE}=`));
      if (lang === "auto" ? hasCookie : lang !== locale || !hasCookie) setLocale(lang === "auto" ? null : lang);
      else onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      width={560}
      fullScreenOnMobile
      footer={
        <>
          <Button variant="text" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="filled" onClick={save} loading={busy}>{t("common.save")}</Button>
        </>
      }
    >
      {err && <ErrorBanner text={err} />}
      <div className="space-y-6 pt-2">
        <TextField
          label={t("settings.senderName")}
          value={name}
          onChange={setName}
          surface="dialog"
          leading="badge"
          supporting={<>{t("settings.senderHint")} <b className="font-medium" dir="auto">{name || "…"} &lt;{email}&gt;</b></>}
        />
        <div>
          <div
            className={cx(
              "relative rounded-[4px] border transition-colors duration-150",
              sigFocus ? "border-accent ring-1 ring-inset ring-accent" : "border-faint hover:border-fg",
            )}
          >
            <span
              className={cx(
                "pointer-events-none absolute -top-2 start-3 bg-panel-2 px-1 type-body-small dark:bg-surface-high",
                sigFocus ? "text-accent" : "text-muted",
              )}
            >
              {t("settings.signature")}
            </span>
            <div
              ref={sig}
              contentEditable
              suppressContentEditableWarning
              aria-label={t("settings.signature")}
              onFocus={() => setSigFocus(true)}
              onBlur={() => setSigFocus(false)}
              data-placeholder={t("settings.signaturePlaceholder")}
              dir="auto"
              className="editor min-h-[112px] px-4 py-4 type-body-large"
            />
          </div>
          <div className="px-4 pt-1 type-body-small text-muted">{t("settings.signatureHint")}</div>
        </div>

        <div className="divide-y divide-line">
          <SettingRow title={t("settings.language")} text={t("settings.languageHint")}>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label={t("settings.language")}
              className="h-10 rounded-lg border border-faint bg-transparent px-3 type-body-large text-fg outline-none focus:border-accent"
            >
              <option value="auto">{t("settings.languageAuto")}</option>
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow title={t("settings.images")} text={t("settings.imagesHint")}>
            <Toggle checked={loadImages} onChange={setLoadImages} label={t("settings.imagesLabel")} />
          </SettingRow>
          <SettingRow title={t("settings.notify")} text={t("settings.notifyHint")}>
            <Toggle checked={notifyOn} onChange={(v) => onNotify(v).catch((e) => setErr((e as Error).message))} label={t("settings.notify")} />
          </SettingRow>
          <SettingRow title={t("settings.undo")} text={t("settings.undoHint")}>
            <Segmented<number>
              label={t("settings.undoLabel")}
              value={undoSeconds}
              onChange={setUndoSeconds}
              className="w-full sm:w-auto"
              options={UNDO_CHOICES.map((n) => ({ value: n, label: n ? t("settings.seconds", { count: n }) : t("settings.off") }))}
            />
          </SettingRow>
        </div>
      </div>
    </Modal>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 type-body-medium text-on-danger-soft">
      <Icon name="error" size={20} />
      <span className="flex-1">{text}</span>
    </div>
  );
}

// ---------- appearance (M3 dynamic color) ----------

export function AppearanceDialog({
  open,
  onClose,
  theme,
  onTheme,
  dark,
}: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  dark: boolean;
}) {
  const t = useT();
  const [a, setA] = useState<Appearance>(() => (typeof window === "undefined" ? readAppearanceSafe() : readAppearance()));
  useEffect(() => {
    if (open) setA(readAppearance());
  }, [open]);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    applyAppearance(next);
  };
  const custom = !SEEDS.some((s) => s.hex.toLowerCase() === a.seed.toLowerCase());

  return (
    <Modal open={open} onClose={onClose} title={t("appearance.title")} width={520} fullScreenOnMobile footer={<Button variant="text" onClick={onClose}>{t("common.ok")}</Button>}>
      <div className="space-y-6 pt-1">
        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.theme")}</h3>
          <Segmented<Theme>
            label={t("appearance.theme")}
            value={theme}
            onChange={onTheme}
            options={[
              { value: "light", label: t("topbar.light"), icon: "light_mode" },
              { value: "dark", label: t("topbar.dark"), icon: "dark_mode" },
              { value: "system", label: t("topbar.system"), icon: "brightness_auto" },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.color")}</h3>
          <div className="grid grid-cols-5 gap-3 sm:grid-cols-9">
            {SEEDS.map((s) => {
              const sw = swatch(s.hex, a.variant, dark);
              const on = s.hex.toLowerCase() === a.seed.toLowerCase();
              return (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => set({ seed: s.hex })}
                  aria-label={t(`appearance.seeds.${s.name}`)}
                  aria-pressed={on}
                  data-tip={t(`appearance.seeds.${s.name}`)}
                  className="sl relative grid aspect-square w-full max-w-14 place-items-center rounded-2xl bg-panel dark:bg-panel-2"
                >
                  <span className="relative h-[70%] w-[70%] overflow-hidden rounded-full">
                    <span className="absolute inset-x-0 top-0 h-1/2" style={{ background: sw.a }} />
                    <span className="absolute bottom-0 start-0 h-1/2 w-1/2" style={{ background: sw.b }} />
                    <span className="absolute bottom-0 end-0 h-1/2 w-1/2" style={{ background: sw.c }} />
                  </span>
                  {on && (
                    <span className="absolute grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-fg shadow-e1">
                      <Icon name="check" size={16} weight={700} />
                    </span>
                  )}
                </button>
              );
            })}
            <label
              data-tip={t("appearance.customColor")}
              className={cx(
                "sl relative grid aspect-square w-full max-w-14 cursor-pointer place-items-center rounded-2xl bg-panel text-muted dark:bg-panel-2",
                custom && "ring-2 ring-accent",
              )}
            >
              <Icon name="colorize" />
              <input
                type="color"
                value={a.seed}
                onChange={(e) => set({ seed: e.target.value })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t("appearance.pickColor")}
              />
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-1 type-title-small text-muted">{t("appearance.style")}</h3>
          <p className="mb-3 type-body-small text-muted">{t("appearance.styleHint")}</p>
          <Segmented<Variant>
            label={t("appearance.style")}
            value={a.variant}
            onChange={(v) => set({ variant: v })}
            options={[
              { value: "tonal", label: t("appearance.tonal") },
              { value: "vibrant", label: t("appearance.vibrant") },
              { value: "fidelity", label: t("appearance.fidelity") },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.contrast")}</h3>
          <Segmented<Contrast>
            label={t("appearance.contrast")}
            value={a.contrast}
            onChange={(v) => set({ contrast: v })}
            options={[
              { value: 0, label: t("appearance.standard"), icon: "contrast" },
              { value: 0.5, label: t("appearance.medium") },
              { value: 1, label: t("appearance.high") },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.density")}</h3>
          <Segmented<Density>
            label={t("appearance.densityLabel")}
            value={a.density}
            onChange={(v) => set({ density: v })}
            options={[
              { value: "default", label: t("appearance.default"), icon: "density_medium" },
              { value: "compact", label: t("appearance.compact"), icon: "density_small" },
            ]}
          />
        </section>
        <p className="pb-2 type-body-small text-muted">{t("appearance.deviceNote")}</p>
      </div>
    </Modal>
  );
}

function readAppearanceSafe(): Appearance {
  return { seed: SEEDS[0].hex, variant: "tonal", contrast: 0, density: "default" };
}

// ---------- shortcuts ----------

const SHORTCUTS: [MessageKey, [MessageKey, string[]][]][] = [
  ["shortcuts.general", [["shortcuts.newMessage", ["C"]], ["shortcuts.search", ["/"]], ["shortcuts.showShortcuts", ["?"]], ["shortcuts.closeClear", ["Esc"]]]],
  ["shortcuts.navigation", [["shortcuts.nextMail", ["J", "↓"]], ["shortcuts.prevMail", ["K", "↑"]], ["shortcuts.open", ["Enter", "O"]], ["folders.inbox", ["G", "I"]], ["folders.sent", ["G", "S"]], ["folders.drafts", ["G", "D"]], ["folders.archive", ["G", "A"]], ["folders.trash", ["G", "T"]]]],
  ["shortcuts.mail", [["shortcuts.reply", ["R"]], ["shortcuts.replyAll", ["A"]], ["shortcuts.forward", ["F"]], ["shortcuts.archive", ["E"]], ["shortcuts.junk", ["!"]], ["shortcuts.delete", ["#", "Del"]], ["shortcuts.move", ["V"]], ["shortcuts.star", ["S"]], ["shortcuts.markUnread", ["U"]], ["shortcuts.markRead", ["Shift", "I"]], ["shortcuts.select", ["X"]]]],
  ["shortcuts.composing", [["shortcuts.send", ["mod", "Enter"]], ["shortcuts.closeSave", ["Esc"]]]],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const mod = isMac() ? "⌘" : "Ctrl";
  return (
    <Modal open={open} onClose={onClose} title={t("shortcuts.title")} width={680} footer={<Button variant="text" onClick={onClose}>{t("common.close")}</Button>}>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {SHORTCUTS.map(([group, items]) => (
          <div key={group}>
            <div className="mb-2 type-title-small text-accent">{t(group)}</div>
            <div>
              {items.map(([label, keys]) => (
                <div key={label} className="flex min-h-9 items-center justify-between gap-3 type-body-medium">
                  <span className="text-fg">{t(label)}</span>
                  <span className="flex items-center gap-1" dir="ltr">
                    {keys.map((k, i) => (
                      <Kbd key={i}>{k === "mod" ? mod : k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- move menu ----------

export function MoveMenu({
  anchor,
  open,
  onClose,
  folders,
  current,
  onPick,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  folders: Folder[];
  current: string;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const list = useMemo(
    () =>
      folders.filter(
        (f) => f.path !== current && f.special !== "drafts" && folderLabel(f, t).toLocaleLowerCase(locale).includes(q.toLocaleLowerCase(locale)),
      ),
    [folders, current, q, t, locale],
  );
  useEffect(() => {
    if (open) {
      setQ("");
      setHi(0);
    }
  }, [open]);
  useEffect(() => setHi(0), [q]);

  return (
    <Popover anchor={anchor} open={open} onClose={onClose} className="w-[280px]">
      <div className="mx-2 mb-2 flex h-12 items-center gap-2 rounded-full bg-surface-highest px-4">
        <Icon name="search" size={20} className="text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            if (e.key === "Enter" && list[hi]) { e.preventDefault(); onPick(list[hi].path); }
          }}
          placeholder={t("move.placeholder")}
          aria-label={t("move.searchLabel")}
          className="h-full w-full bg-transparent type-body-large outline-none placeholder:text-muted"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {list.map((f, i) => (
          <button
            key={f.path}
            type="button"
            role="menuitem"
            onMouseEnter={() => setHi(i)}
            onClick={() => onPick(f.path)}
            className={cx("sl flex h-12 w-full items-center gap-3 pe-4 text-left type-label-large text-fg", i === hi && "bg-hover")}
            style={{ paddingInlineStart: 12 + Math.min(f.depth, 4) * 14 }}
          >
            <FolderGlyph f={f} className="text-muted" />
            <span className="truncate">{folderLabel(f, t)}</span>
          </button>
        ))}
        {!list.length && <div className="px-4 py-3 text-center type-body-medium text-muted">{t("move.none")}</div>}
      </div>
    </Popover>
  );
}

// ---------- snackbar ----------

export type ToastAction = { label: string; run: () => void };
export type Toast = {
  id: number;
  text: string;
  tone?: "error" | "ok";
  action?: ToastAction;
  secondary?: ToastAction;
  countdown?: number;
  busy?: boolean;
  leaving?: boolean;
};

export function Toasts({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  const t = useT();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:start-6 md:items-start"
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto relative flex min-h-12 w-full items-center gap-1 overflow-hidden rounded-[4px] py-1 ps-4 pe-2 type-body-medium shadow-e3 md:w-auto md:min-w-[344px] md:max-w-[560px]",
            toast.tone === "error" ? "bg-danger-soft text-on-danger-soft" : "bg-inverse text-inverse-fg",
            toast.leaving ? "m3-snack-out" : "m3-snack-in",
          )}
        >
          {toast.busy && <Spinner className="-ms-1 me-1.5 h-5 w-5 text-inverse-accent" />}
          {toast.tone === "error" && <Icon name="error" size={20} className="-ms-1 me-1.5" />}
          <span className="flex-1 py-2.5 pe-2">{toast.text}</span>
          {[toast.secondary, toast.action].map(
            (a, i) =>
              a && (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    a.run();
                    onDismiss(toast.id);
                  }}
                  className={cx(
                    "sl h-10 shrink-0 rounded-full px-3 type-label-large",
                    i === 0 ? "opacity-80" : toast.tone === "error" ? "text-danger" : "text-inverse-accent",
                  )}
                >
                  {a.label}
                </button>
              ),
          )}
          <IconButton label={t("common.close")} tip={false} onClick={() => onDismiss(toast.id)} className="!text-current opacity-80">
            <Icon name="close" size={20} />
          </IconButton>
          {!!toast.countdown && (
            <span
              className="absolute bottom-0 start-0 h-[3px] w-full origin-left bg-current rtl:origin-right opacity-30"
              style={{ animation: `toast-countdown ${toast.countdown}s linear forwards` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- folder dialog ----------

export type FolderDialogState =
  | { kind: "create"; parent?: Folder }
  | { kind: "rename"; folder: Folder }
  | { kind: "delete"; folder: Folder };

type FolderOp = { action: "create"; name: string; parent?: string } | { action: "rename"; path: string; name: string } | { action: "delete"; path: string };

export function FolderDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: FolderDialogState | null;
  onClose: () => void;
  onSubmit: (op: FolderOp) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // keep the last content visible while the close animation runs
  const last = useRef<FolderDialogState | null>(null);
  if (state) last.current = state;
  const st = state || last.current;

  // don't reset when the folder list refreshes (counts), only when a new dialog opens
  const key = !state ? "" : state.kind === "create" ? `create|${state.parent?.path || ""}` : `${state.kind}|${state.folder.path}`;
  useEffect(() => {
    if (!state) return;
    setName(state.kind === "rename" ? state.folder.name : "");
    setErr("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const title = !st
    ? ""
    : st.kind === "delete"
      ? t("folderDialog.deleteTitle")
      : st.kind === "rename"
        ? t("folderDialog.renameTitle")
        : st.parent
          ? t("folderDialog.subfolderTitle")
          : t("folderDialog.newTitle");

  async function submit() {
    if (!state || busy) return;
    if (state.kind !== "delete" && !name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(
        state.kind === "create"
          ? { action: "create", name, parent: state.parent?.path }
          : state.kind === "rename"
            ? { action: "rename", path: state.folder.path, name }
            : { action: "delete", path: state.folder.path },
      );
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title={title}
      width={st?.kind === "delete" ? 400 : 440}
      icon={st?.kind === "delete" ? <Icon name="folder_delete" className="text-danger" /> : undefined}
      footer={
        st && (
          <>
            <Button variant="text" onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant={st.kind === "delete" ? "danger" : "filled"}
              onClick={submit}
              loading={busy}
              disabled={st.kind !== "delete" && !name.trim()}
            >
              {st.kind === "delete" ? t("common.delete") : st.kind === "rename" ? t("common.save") : t("common.create")}
            </Button>
          </>
        )
      }
    >
      {st?.kind === "delete" ? (
        <>
          {err && <ErrorBanner text={err} />}
          <p className="type-body-medium text-muted">
            {rich(t("folderDialog.deleteText"), { folder: <span className="font-medium text-fg">{st.folder.name}</span> })}
            {st.folder.total > 0 && <> {t("folderDialog.deleteMoved", { count: st.folder.total })}</>}
          </p>
        </>
      ) : (
        st && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="pt-2"
          >
            {st.kind === "create" && st.parent && (
              <p className="mb-4 flex items-center gap-2 type-body-medium text-muted">
                <Icon name="subdirectory_arrow_right" size={20} />
                <span>{rich(t("folderDialog.inside"), { folder: <span className="font-medium text-fg">{st.parent.name}</span> })}</span>
              </p>
            )}
            <TextField
              label={t("folderDialog.name")}
              value={name}
              onChange={setName}
              autoFocus
              maxLength={80}
              surface="dialog"
              leading="folder"
              error={err || undefined}
            />
          </form>
        )
      )}
    </Modal>
  );
}
