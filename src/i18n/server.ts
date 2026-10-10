import "server-only";
import { cookies, headers } from "next/headers";
import { createT, withFallback, type Messages, type TFunction } from "./format";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, matchLocale, negotiate } from "./locales";
import en from "./messages/en.json";

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  ar: () => import("./messages/ar.json"),
  cs: () => import("./messages/cs.json"),
  da: () => import("./messages/da.json"),
  de: () => import("./messages/de.json"),
  el: () => import("./messages/el.json"),
  es: () => import("./messages/es.json"),
  fa: () => import("./messages/fa.json"),
  fi: () => import("./messages/fi.json"),
  fr: () => import("./messages/fr.json"),
  he: () => import("./messages/he.json"),
  hi: () => import("./messages/hi.json"),
  hu: () => import("./messages/hu.json"),
  id: () => import("./messages/id.json"),
  it: () => import("./messages/it.json"),
  ja: () => import("./messages/ja.json"),
  ko: () => import("./messages/ko.json"),
  nb: () => import("./messages/nb.json"),
  nl: () => import("./messages/nl.json"),
  pl: () => import("./messages/pl.json"),
  pt: () => import("./messages/pt.json"),
  ro: () => import("./messages/ro.json"),
  ru: () => import("./messages/ru.json"),
  sv: () => import("./messages/sv.json"),
  th: () => import("./messages/th.json"),
  tr: () => import("./messages/tr.json"),
  uk: () => import("./messages/uk.json"),
  vi: () => import("./messages/vi.json"),
  "zh-CN": () => import("./messages/zh-CN.json"),
  "zh-TW": () => import("./messages/zh-TW.json"),
};

const merged = new Map<string, Messages>([["en", en]]);

export async function getMessages(locale: string): Promise<Messages> {
  const hit = merged.get(locale);
  if (hit) return hit;
  const load = loaders[locale];
  const m = load ? (withFallback(en, (await load()).default) as Messages) : en;
  merged.set(locale, m);
  return m;
}

/** Instance default: DEFAULT_LOCALE env if supported, otherwise English. */
export function instanceLocale() {
  return matchLocale(process.env.DEFAULT_LOCALE) || DEFAULT_LOCALE;
}

/** Request locale: explicit choice (cookie) → browser languages → instance default. */
export async function getLocale(): Promise<string> {
  const jar = await cookies();
  const chosen = matchLocale(jar.get(LOCALE_COOKIE)?.value);
  if (chosen && LOCALES.some((l) => l.code === chosen)) return chosen;
  const h = await headers();
  return negotiate(h.get("accept-language")) || instanceLocale();
}

export async function getT(): Promise<{ t: TFunction; locale: string; messages: Messages }> {
  const locale = await getLocale();
  const messages = await getMessages(locale);
  return { t: createT(locale, messages, en), locale, messages };
}
