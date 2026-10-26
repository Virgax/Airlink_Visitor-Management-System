import { db } from "@/lib/db";

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: Date };

/**
 * Fixed-window rate limit stored in Postgres so it works across replicas.
 * `key` should include the scope, e.g. `login:ip:1.2.3.4` or `scan:user:<id>`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);
  const row = await db.rateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt };
}

/** Clears the current window for a key (e.g. after a successful login so only failures accumulate). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Called by the cron tick: drops windows older than one day. */
export async function purgeRateLimits(): Promise<number> {
  const res = await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
  return res.count;
}
