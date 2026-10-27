import "server-only";
import { redirect } from "next/navigation";
import type { Site } from "@prisma/client";
import { db } from "@/lib/db";
import { getDevice } from "@/lib/auth/kiosk";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export type KioskSession = {
  device: NonNullable<Awaited<ReturnType<typeof getDevice>>>;
  user: SessionUser;
  site: Site;
};

/**
 * Kiosk pages: the browser must hold an enrolled device cookie and a session opened on that device with a PIN
 * (`Session.guardDeviceId === device.id`). Anything else goes back to `/guard`, which enrolls or asks for the PIN.
 * Slice C ships a similar `requireKiosk()`; the integrator unifies both.
 */
export async function requireKioskSession(): Promise<KioskSession> {
  const session = await getKioskSessionOrNull();
  if (!session) redirect("/guard");
  return session;
}

/** Same check without redirecting (server actions that redirect with their own error codes). */
export async function getKioskSessionOrNull(): Promise<KioskSession | null> {
  const device = await getDevice();
  if (!device) return null;
  const user = await getSessionUser();
  if (!user || user.guardDeviceId !== device.id) return null;
  const site = await db.site.findUnique({ where: { id: device.siteId } });
  if (!site || !site.active) return null;
  return { device, user, site };
}
