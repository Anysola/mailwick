// Supported UI languages. To add one: create messages/<code>.json (copy en.json),
// add it here and in server.ts. Missing keys fall back to English.

export type LocaleInfo = { code: string; name: string; dir?: "rtl" };

export const LOCALES: LocaleInfo[] = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "cs", name: "Čeština" },
  { code: "da", name: "Dansk" },
  { code: "de", name: "Deutsch" },
  { code: "el", name: "Ελληνικά" },
  { code: "es", name: "Español" },
  { code: "fa", name: "فارسی", dir: "rtl" },
  { code: "fi", name: "Suomi" },
  { code: "fr", name: "Français" },
  { code: "he", name: "עברית", dir: "rtl" },
  { code: "hi", name: "हिन्दी" },
  { code: "hu", name: "Magyar" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "nb", name: "Norsk bokmål" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "pt", name: "Português" },
  { code: "ro", name: "Română" },
  { code: "ru", name: "Русский" },
  { code: "sv", name: "Svenska" },
  { code: "th", name: "ไทย" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
];

export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "mw_locale";

export function isRtl(code: string) {
  return LOCALES.find((l) => l.code === code)?.dir === "rtl";
}

/** Maps any tag ("pt-BR", "zh-hk", "nb-NO", "no") to a supported locale, or null. */
export function matchLocale(tag: string | undefined | null): string | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase().replace("_", "-");
  const exact = LOCALES.find((l) => l.code.toLowerCase() === t);
  if (exact) return exact.code;
  if (t.startsWith("zh")) return /-(tw|hk|mo|hant)/.test(t) ? "zh-TW" : "zh-CN";
  const base = t.split("-")[0];
  if (base === "no" || base === "nn") return "nb";
  return LOCALES.find((l) => l.code.toLowerCase() === base)?.code ?? null;
}

/** Picks the best supported locale from an Accept-Language header. */
export function negotiate(header: string | null | undefined): string | null {
  if (!header) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const m = matchLocale(tag);
    if (m) return m;
  }
  return null;
}
