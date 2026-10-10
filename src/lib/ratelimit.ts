import "server-only";
import { redis } from "./redis";

/** Fixed-window counter; returns the seconds remaining if the limit is exceeded. */
export async function hit(key: string, limit: number, windowSec: number): Promise<number> {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  if (n > limit) return Math.max(1, await redis.ttl(k));
  return 0;
}

export async function clear(key: string) {
  await redis.del(`rl:${key}`);
}
