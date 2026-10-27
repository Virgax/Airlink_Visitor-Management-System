import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(256) }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

async function body(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Stores the browser's push subscription for the signed-in user (kiosk sessions are not accepted). */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.guardDeviceId) return Response.json({ ok: false }, { status: 401 });
  const limit = await rateLimit(`push:subscribe:${user.id}`, 30, 600);
  if (!limit.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const parsed = subscribeSchema.safeParse(await body(request));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const userAgent = request.headers.get("user-agent")?.slice(0, 255) ?? null;
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
  log.info("push.subscribed", { userId: user.id });
  return Response.json({ ok: true });
}

/** Removes a subscription of the signed-in user. */
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false }, { status: 401 });
  const parsed = unsubscribeSchema.safeParse(await body(request));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  const res = await db.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: user.id } });
  log.info("push.unsubscribed", { userId: user.id, removed: res.count });
  return Response.json({ ok: true, removed: res.count });
}
