"use client";

import { createContext, useContext, useMemo } from "react";
import { createT, type Messages, type TFunction } from "./format";
import { LOCALE_COOKIE } from "./locales";

export type Brand = { name: string; logoUrl?: string };

type Ctx = { locale: string; t: TFunction; brand: Brand };

const I18nContext = createContext<Ctx | null>(null);

// Module-level copy for code that runs only in the browser outside React render
// (event handlers, fetch helpers, compose templates). Never read it during server render.
let active: Ctx = { locale: "en", t: (k) => k, brand: { name: "Mailwick" } };

export function I18nProvider({ locale, messages, brand, children }: { locale: string; messages: Messages; brand: Brand; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(locale, messages), brand }), [locale, messages, brand]);
  if (typeof window !== "undefined") active = value;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useCtx() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}

export const useT = () => useCtx().t;
export const useLocale = () => useCtx().locale;
export const useBrand = () => useCtx().brand;

/** Browser-only translator (see note on `active`). */
export const t: TFunction = (key, vars) => active.t(key, vars);
export const currentLocale = () => active.locale;

/** Saves the language choice for a year and reloads so server-rendered text follows. */
export function setLocale(code: string | null) {
  document.cookie = code
    ? `${LOCALE_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`
    : `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  window.location.reload();
}

/** Like t(), but placeholders listed in `nodes` are replaced with React nodes (bold names etc.). */
export function rich(text: string, nodes: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : part;
  });
}
