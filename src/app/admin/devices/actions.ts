"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { createEnrollCode } from "@/lib/auth/kiosk";
import { audit } from "@/lib/audit";

const createSchema = z.object({ name: z.string().trim().min(2).max(80), gateId: z.string().min(1) });

export async function createDeviceAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/devices?error=invalid");
  // The gate names its site: no separate site field to get out of step with it.
  const gate = await db.gate.findFirst({ where: { id: parsed.data.gateId, active: true } });
  if (!gate) redirect("/admin/devices?error=invalid");
  assertSiteAllowed(tenant, gate.siteId);
  const device = await db.guardDevice.create({ data: { name: parsed.data.name, siteId: gate.siteId, gateId: gate.id } });
  await audit({ action: "device.created", siteId: device.siteId, actorId: tenant.user.id, targetType: "GuardDevice", targetId: device.id });
  const code = await createEnrollCode(device.id);
  redirect(`/admin/devices?device=${device.id}&code=${code}`);
}

export async function generateCodeAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const deviceId = String(formData.get("deviceId") ?? "");
  const device = await db.guardDevice.findFirst({ where: { id: deviceId, active: true, ...tenant.siteFilter } });
  if (!device) redirect("/admin/devices?error=invalid");
  const code = await createEnrollCode(device.id);
  redirect(`/admin/devices?device=${device.id}&code=${code}`);
}
