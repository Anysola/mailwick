"use client";

import type { Addr } from "./types";
import { currentLocale, t } from "@/i18n/client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers || {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401 && !url.startsWith("/api/auth")) {
    window.location.href = "/login";
    throw new ApiError(401, t("common.sessionClosed"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || t("common.somethingWrong"));
  return data as T;
}

// Date helpers run in the browser only (lists and messages load client-side), in the UI language.
export function shortDate(iso: string) {
  const L = currentLocale();
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t("common.yesterday");
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString(L, { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(L, { day: "numeric", month: "short" });
  return d.toLocaleDateString(L, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function longDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(currentLocale(), { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function mediumDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(currentLocale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), hour: "2-digit", minute: "2-digit" });
}

export function relative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  if (diff < 60) return t("common.justNow");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 86400 * 7) return rtf.format(-Math.round(diff / 86400), "day");
  return null;
}

export function displayName(a?: Addr) {
  if (!a) return t("common.unknown");
  return a.name?.trim() || a.address.split("@")[0];
}

export function fmtAddr(a: Addr) {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function initials(a?: Addr) {
  const n = displayName(a).replace(/["'()[\]]/g, "").trim();
  const parts = n.split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : n.slice(0, 1);
  return s.toLocaleUpperCase(currentLocale());
}

const HUES = [12, 32, 145, 168, 195, 220, 245, 268, 292, 330];
export function hueFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Strips reply/forward prefixes in common languages ("Re:", "Fwd:", "AW:", "SV:", "Ynt:", …). */
export function stripPrefix(subject: string) {
  return subject.replace(/^(\s*(re|fwd?|fw|aw|wg|sv|tr|r|rif|odp|res|enc|ynt|ilt|yanıt|ilet|antw|doorst|vl|vb|απ|πρθ|回复|转发|答复|回覆|轉寄)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
