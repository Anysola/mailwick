import type { NextRequest } from "next/server";
import { jsonError, json, sameOrigin } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyLogin } from "@/lib/imap";
import { clear, hit } from "@/lib/ratelimit";
import { createSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError(403, "errors.badOrigin");

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown; remember?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 500) {
    return jsonError(400, "errors.loginInput");
  }
  const domain = email.split("@")[1];
  if (env.allowedDomains.length && !env.allowedDomains.includes(domain)) {
    return jsonError(403, "errors.domainNotAllowed", { domains: env.allowedDomains.map((d) => "@" + d).join(", ") });
  }

  const wait = Math.max(await hit(`ip:${clientIp(req)}`, 30, 15 * 60), await hit(`em:${email}`, 8, 15 * 60));
  if (wait) return jsonError(429, "errors.tooManyAttempts", { count: Math.ceil(wait / 60) });

  let res: Awaited<ReturnType<typeof verifyLogin>>;
  try {
    res = await verifyLogin(email, password);
  } catch (e) {
    console.error("[mail] login", (e as Error).message);
    return jsonError(502, "errors.unreachable");
  }
  if (!res.ok && res.reason === "mfa") return jsonError(401, "errors.mfa", undefined, { code: "mfa" });
  if (!res.ok) return jsonError(401, "errors.wrongCredentials");

  await clear(`em:${email}`);
  await createSession(email, password, body?.remember === true);
  return json({ ok: true });
}

/** Client IP for rate limiting. Proxy headers are only trusted when TRUST_PROXY=1. */
function clientIp(req: NextRequest) {
  if (!env.trustProxy) return "direct";
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
}
