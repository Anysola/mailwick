// Material 3 dynamic color: generates every color role from a seed color.
// Runs in the browser when the appearance changes; the defaults are baked into globals.css.

import {
  argbFromHex, Hct, hexFromArgb, MaterialDynamicColors, SchemeFidelity, SchemeTonalSpot, SchemeVibrant,
  type DynamicScheme,
} from "@material/material-color-utilities";

export type Variant = "tonal" | "vibrant" | "fidelity";
export type Contrast = 0 | 0.5 | 1;
export type Density = "default" | "compact";
export type Appearance = { seed: string; variant: Variant; contrast: Contrast; density: Density };

export const DEFAULT_APPEARANCE: Appearance = { seed: "#4c52c7", variant: "tonal", contrast: 0, density: "default" };

export const SEEDS = [
  { hex: "#4c52c7", name: "indigo" },
  { hex: "#1a73e8", name: "blue" },
  { hex: "#00838f", name: "teal" },
  { hex: "#2e7d32", name: "green" },
  { hex: "#b26a00", name: "amber" },
  { hex: "#c2185b", name: "rose" },
  { hex: "#7b1fa2", name: "purple" },
  { hex: "#5f6368", name: "gray" },
] as const;

// Roles we use (CSS variable: --md-<kebab>)
const ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary", "primaryFixedDim",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "surface", "surfaceDim", "surfaceBright", "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer",
  "surfaceContainerHigh", "surfaceContainerHighest", "onSurface", "onSurfaceVariant",
  "outline", "outlineVariant", "inverseSurface", "inverseOnSurface", "scrim", "shadow",
] as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

function scheme(a: Appearance, dark: boolean): DynamicScheme {
  const hct = Hct.fromInt(argbFromHex(a.seed));
  const S = a.variant === "vibrant" ? SchemeVibrant : a.variant === "fidelity" ? SchemeFidelity : SchemeTonalSpot;
  return new S(hct, dark, a.contrast);
}

export function schemeColors(a: Appearance, dark: boolean): Record<string, string> {
  const s = scheme(a, dark);
  const out: Record<string, string> = {};
  for (const r of ROLES) {
    const dc = (MaterialDynamicColors as unknown as Record<string, { getArgb: (s: DynamicScheme) => number }>)[r];
    out[r] = hexFromArgb(dc.getArgb(s));
  }
  return out;
}

function block(c: Record<string, string>) {
  return Object.entries(c)
    .map(([k, v]) => `--md-${kebab(k)}:${v}`)
    .join(";");
}

/** All color variables for :root (light) and [data-theme=dark]. */
export function appearanceCss(a: Appearance) {
  // the html: prefix beats the globals.css defaults regardless of order
  return `html:root{${block(schemeColors(a, false))}}html[data-theme="dark"]{${block(schemeColors(a, true))}}`;
}

export function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

export function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem("mw-appearance") || "{}") as Partial<Appearance>;
    return {
      seed: isHex(raw.seed) ? raw.seed : DEFAULT_APPEARANCE.seed,
      variant: raw.variant === "vibrant" || raw.variant === "fidelity" ? raw.variant : "tonal",
      contrast: raw.contrast === 0.5 || raw.contrast === 1 ? raw.contrast : 0,
      density: raw.density === "compact" ? "compact" : "default",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Applies and stores on this device; the layout script loads the same CSS before first paint. */
export function applyAppearance(a: Appearance) {
  const css = appearanceCss(a);
  let el = document.getElementById("mw-scheme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "mw-scheme";
    document.head.appendChild(el);
  }
  el.textContent = css;
  document.documentElement.dataset.density = a.density;
  try {
    localStorage.setItem("mw-appearance", JSON.stringify(a));
    localStorage.setItem("mw-scheme-css", css);
  } catch {}
  // browser toolbar color
  const dark = document.documentElement.dataset.theme === "dark";
  const bar = schemeColors(a, dark).surfaceContainerLow;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bar));
}

/** Swatch in the color picker: a three-tone preview like on Android. */
export function swatch(seed: string, variant: Variant, dark: boolean) {
  const c = schemeColors({ ...DEFAULT_APPEARANCE, seed, variant }, dark);
  return { a: c.primary, b: c.secondaryContainer, c: c.tertiaryContainer, ring: c.onSurface };
}
