import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Liveness/readiness for Docker and uptime checks: 200 when Redis answers. */
export async function GET() {
  try {
    await redis.ping();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
