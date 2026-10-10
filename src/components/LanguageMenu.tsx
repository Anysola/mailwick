"use client";

import { useRef, useState } from "react";
import { setLocale, useLocale, useT } from "@/i18n/client";
import { LOCALES } from "@/i18n/locales";
import { Icon, IconButton, MenuItem, Popover } from "./ui";

/** Globe button with the list of languages (login page). */
export function LanguageMenu() {
  const t = useT();
  const locale = useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={anchor} label={t("common.language")} onClick={() => setOpen((v) => !v)}>
        <Icon name="language" />
      </IconButton>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" className="max-h-[70vh] w-[220px] overflow-y-auto">
        {LOCALES.map((l) => (
          <MenuItem
            key={l.code}
            icon={l.code === locale ? <Icon name="check" /> : <span className="w-6" />}
            onClick={() => {
              setOpen(false);
              if (l.code !== locale) setLocale(l.code);
            }}
          >
            <span lang={l.code} dir={l.dir || "ltr"}>{l.name}</span>
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
