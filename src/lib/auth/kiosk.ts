import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { GateKind, GuardDevice, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto/tokens";
import { isProd } from "@/lib/env";
import { DEVICE_COOKIE, getSessionUser, type SessionUser } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/guards";

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

export type KioskSite = { id: string; name: string; timezone: string; settings: Prisma.JsonValue };
export type KioskGate = { id: string; name: string; kind: GateKind; settings: Prisma.JsonValue };
export type EnrolledDevice = GuardDevice & { site: KioskSite; gate: KioskGate };

/** The enrolled device for this browser, or null. */
export async function getDevice(): Promise<EnrolledDevice | null> {
  const jar = await cookies();
  const token = jar.get(DEVICE_COOKIE)?.value;
  if (!token) return null;
  const device = await db.guardDevice.findUnique({
    where: { deviceTokenHash: sha256(token) },
    include: {
      site: { select: { id: true, name: true, timezone: true, settings: true } },
      gate: { select: { id: true, name: true, kind: true, settings: true } },
    },
  });
  if (!device || !device.active || !device.site || !device.gate) return null;
  return device;
}

export type KioskContext = { user: SessionUser; device: EnrolledDevice; site: KioskSite; gate: KioskGate };

/**
 * The kiosk session for this browser: an enrolled device plus a security session opened on it with a PIN.
 * Null when either is missing. Everything under /guard/* must use this and scope queries by `site.id`.
 */
export async function getKiosk(): Promise<KioskContext | null> {
  const device = await getDevice();
  if (!device) return null;
  const user = await getSessionUser();
  if (!user || user.guardDeviceId !== device.id) return null;
  return { user, device, site: device.site, gate: device.gate };
}

/** Kiosk pages: redirects to /guard (enroll or PIN screen) when there is no kiosk session. */
export async function requireKiosk(): Promise<KioskContext> {
  const kiosk = await getKiosk();
  if (!kiosk) redirect("/guard");
  return kiosk;
}

/** Kiosk route handlers and server actions: throws instead of redirecting. */
export async function getKioskOrThrow(): Promise<KioskContext> {
  const kiosk = await getKiosk();
  if (!kiosk) throw new AuthError("unauthenticated");
  return kiosk;
}

export async function touchDevice(deviceId: string): Promise<void> {
  await db.guardDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
}
