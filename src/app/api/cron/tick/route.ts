import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto/tokens";
import { withAdvisoryLock } from "@/lib/jobs/withAdvisoryLock";
import { expirePasses } from "@/lib/server/passes";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { purgeRateLimits } from "@/lib/rateLimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Called every 5 minutes by the Railway cron service. Each job runs under an advisory lock. */
export async function POST(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const result = await withAdvisoryLock("cron.tick", async () => {
    const expired = await expirePasses();
    const sessions = await purgeExpiredSessions();
    const limits = await purgeRateLimits();
    // Phase 1: unannounced visit timeouts/escalation, overstay alerts, reminders, media retention purge.
    return { expired, sessions, limits };
  });
  log.info("cron.tick", result as Record<string, unknown>);
  return Response.json({ ok: true, ...result });
}
