"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { enrollDevice, getDevice, touchDevice } from "@/lib/auth/kiosk";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export async function enrollAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  const limit = await rateLimit(`enroll:any`, 30, 600);
  if (!limit.ok || code.length < 4) redirect("/guard?error=enroll");
  const device = await enrollDevice(code);
  if (!device) redirect("/guard?error=enroll");
  await audit({ action: "device.enrolled", siteId: device.siteId, targetType: "GuardDevice", targetId: device.id });
  redirect("/guard");
}

const pinSchema = z.object({ userId: z.string().min(1), pin: z.string().regex(/^\d{4,8}$/) });

export async function pinLoginAction(formData: FormData): Promise<void> {
  const device = await getDevice();
  if (!device) redirect("/guard");
  const parsed = pinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/guard?error=pin");

  const limit = await rateLimit(`pin:device:${device.id}`, 10, 60);
  if (!limit.ok) redirect("/guard?error=rateLimited");

  const user = await db.user.findFirst({
    where: {
      id: parsed.data.userId,
      status: "active",
      pinHash: { not: null },
      memberships: { some: { role: "security", status: "active", OR: [{ siteId: device.siteId }, { siteId: null }] } },
    },
  });
  if (!user || !(await verifyPassword(parsed.data.pin, user.pinHash))) {
    await audit({ action: "auth.login_failed", siteId: device.siteId, meta: { kiosk: device.id, userId: parsed.data.userId } });
    redirect("/guard?error=pin");
  }
  await createSession(user.id, { guardDeviceId: device.id });
  await touchDevice(device.id);
  await audit({ action: "auth.kiosk_login", siteId: device.siteId, actorId: user.id, targetType: "GuardDevice", targetId: device.id });
  redirect("/guard");
}

export async function lockAction(): Promise<void> {
  await destroySession();
  redirect("/guard");
}
