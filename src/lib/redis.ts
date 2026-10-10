import "server-only";
import { Redis } from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { __mailRedis?: Redis };

export const redis: Redis =
  g.__mailRedis ??
  (g.__mailRedis = new Redis(env.redisUrl, {
    keyPrefix: env.redisPrefix,
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  }));
