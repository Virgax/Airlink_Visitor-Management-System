import "server-only";
import { cookies } from "next/headers";
import type { GuardDevice } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto/tokens";
import { isProd } from "@/lib/env";
import { DEVICE_COOKIE } from "@/lib/auth/session";

const DEVICE_COOKIE_DAYS = 365;
const ENROLL_CODE_MINUTES = 15;

/** Admin side: creates a one-time enrollment code for a device (returned once, only the hash is stored). */
export async function createEnrollCode(deviceId: string): Promise<string> {
  const code = randomToken(6).replace(/[-_]/g, "").slice(0, 8).toUpperCase();
  await db.guardDevice.update({
    where: { id: deviceId },
    data: { enrollCodeHash: sha256(code), enrollExpiresAt: new Date(Date.now() + ENROLL_CODE_MINUTES * 60_000) },
  });
  return code;
}

/** Kiosk side: exchanges the enrollment code for a long-lived HttpOnly device cookie. */
export async function enrollDevice(code: string): Promise<GuardDevice | null> {
  const device = await db.guardDevice.findUnique({ where: { enrollCodeHash: sha256(code.trim().toUpperCase()) } });
  if (!device || !device.active || !device.enrollExpiresAt || device.enrollExpiresAt < new Date()) return null;
  const token = randomToken(32);
  const updated = await db.guardDevice.update({
    where: { id: device.id },
    data: { deviceTokenHash: sha256(token), enrollCodeHash: null, enrollExpiresAt: null, lastSeenAt: new Date() },
  });
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_DAYS * 86_400,
  });
  return updated;
}

/** The enrolled device for this browser, or null. */
export async function getDevice(): Promise<(GuardDevice & { site: { id: string; name: string }; gate: { id: string; name: string } }) | null> {
  const jar = await cookies();
  const token = jar.get(DEVICE_COOKIE)?.value;
  if (!token) return null;
  const device = await db.guardDevice.findUnique({
    where: { deviceTokenHash: sha256(token) },
    include: { site: { select: { id: true, name: true } }, gate: { select: { id: true, name: true } } },
  });
  if (!device || !device.active) return null;
  return device;
}

export async function touchDevice(deviceId: string): Promise<void> {
  await db.guardDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
}
