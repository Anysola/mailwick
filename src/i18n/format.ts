// Tiny message formatter shared by server and client.
// Messages are nested JSON; a leaf is a string or a plural object ({ one, other, few, … }).
// Placeholders look like {name}; plural objects are chosen by the numeric {count} variable.

import type en from "./messages/en.json";

export type Messages = typeof en;
type PluralLeaf = { other: string };
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends PluralLeaf ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type Vars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

type Tree = { [k: string]: string | Tree };

function lookup(tree: Tree, key: string): string | Tree | undefined {
  let cur: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (!cur || typeof cur === "string") return undefined;
    cur = cur[part];
  }
  return cur;
}

export function createT(locale: string, messages: unknown, fallback?: unknown): TFunction {
  const rules = new Intl.PluralRules(locale);
  const nf = new Intl.NumberFormat(locale);
  return (key, vars) => {
    let v = lookup(messages as Tree, key);
    if (v === undefined && fallback) v = lookup(fallback as Tree, key);
    if (v === undefined) return key;
    if (typeof v !== "string") {
      const n = typeof vars?.count === "number" ? vars.count : 0;
      const form = v[rules.select(n)] ?? v.other;
      v = typeof form === "string" ? form : key;
    }
    if (!vars) return v;
    return v.replace(/\{(\w+)\}/g, (m, name: string) => {
      const x = vars[name];
      if (x === undefined) return m;
      return typeof x === "number" ? nf.format(x) : x;
    });
  };
}

/** Deep-merges a translation over the English base so missing keys still show English. */
export function withFallback(base: unknown, over: unknown): unknown {
  if (typeof base !== "object" || base === null) return typeof over === typeof base ? over : base;
  const b = base as Tree;
  const o = (typeof over === "object" && over !== null ? over : {}) as Tree;
  // plural objects: take the translation whole (languages have different plural forms)
  if ("other" in b && typeof b.other === "string") return typeof o.other === "string" ? o : b;
  const out: Tree = {};
  for (const k of Object.keys(b)) out[k] = withFallback(b[k], o[k]) as Tree;
  return out;
}
