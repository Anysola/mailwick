import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, type Session } from "./session";
import { dropClient } from "./imap";
import { getT } from "@/i18n/server";
import type { MessageKey, Vars } from "@/i18n/format";

/** An error with a translatable message; route() renders it in the request's language. */
export class HttpError extends Error {
  constructor(public status: number, public key: MessageKey, public vars?: Vars) {
    super(key);
  }
}

/** JSON error response in the request's language. */
export async function jsonError(status: number, key: MessageKey, vars?: Vars, extra?: Record<string, unknown>) {
  const { t } = await getT();
  return json({ error: t(key, vars), ...extra }, status);
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Same-origin check for state-changing requests (CSRF). */
export function sameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler = (req: NextRequest, s: Session) => Promise<Response>;

export function route(fn: Handler) {
  return async (req: NextRequest) => {
    if (!sameOrigin(req)) return jsonError(403, "errors.badOrigin");
    const s = await getSession();
    if (!s) return jsonError(401, "errors.notSignedIn");
    try {
      return await fn(req, s);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.key, e.vars);
      const err = e as { authenticationFailed?: boolean; code?: string; message?: string };
      if (err.authenticationFailed) {
        dropClient(s.id);
        return jsonError(401, "errors.passwordChanged");
      }
      // reconnect on the next request after a dropped connection
      if (err.code === "NoConnection" || err.code === "ETIMEDOUT" || err.code === "ECONNRESET") dropClient(s.id);
      console.error("[mail]", req.method, req.nextUrl.pathname, err.code || "", err.message);
      return jsonError(502, "errors.server");
    }
  };
}

export function str(v: unknown, max = 1000): string {
  if (typeof v !== "string") throw new HttpError(400, "errors.missingField");
  if (v.length > max) throw new HttpError(400, "errors.fieldTooLong");
  return v;
}

/** A UID list or "all" (every message in the folder). */
export type UidSel = number[] | "all";

export function uidSel(v: unknown): UidSel {
  return v === "all" ? "all" : uidList(v);
}

export function uidList(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length || v.length > 1000) throw new HttpError(400, "errors.badSelection");
  const out = v.map(Number);
  if (out.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, "errors.badSelection");
  return out;
}
