import "server-only";
import { cookies, headers } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto/tokens";
import { isProd } from "@/lib/env";

import { SESSION_COOKIE, SITE_COOKIE, DEVICE_COOKIE } from "@/lib/auth/cookies";

export { SESSION_COOKIE, SITE_COOKIE, DEVICE_COOKIE };

const SESSION_DAYS = 30;
const KIOSK_SESSION_HOURS = 12;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export type SessionUser = Pick<User, "id" | "email" | "name" | "locale" | "status" | "employeeId"> & {
  guardDeviceId: string | null;
};

export async function createSession(userId: string, opts: { guardDeviceId?: string } = {}): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const ttlMs = opts.guardDeviceId ? KIOSK_SESSION_HOURS * 3_600_000 : SESSION_DAYS * 86_400_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 255) ?? null,
      ip: clientIp(h),
      guardDeviceId: opts.guardDeviceId ?? null,
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
  jar.delete(SITE_COOKIE);
}

/** Current user from the session cookie, or null. Touches lastSeenAt at most every 10 minutes. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, name: true, locale: true, status: true, employeeId: true } },
    },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== "active") return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { ...session.user, guardDeviceId: session.guardDeviceId };
}

export function clientIp(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return h.get("x-real-ip");
}

/** Removes expired sessions (cron). */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}
