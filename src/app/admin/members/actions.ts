"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "security", "approver", "host"]),
  siteId: z.string().optional(),
  pin: z.string().trim().optional(),
});

export async function addMemberAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/members?error=invalid");
  const { email, name, role } = parsed.data;
  const siteId = parsed.data.siteId ? parsed.data.siteId : null;
  const pin = parsed.data.pin ? parsed.data.pin : null;
  if (pin && !/^\d{4,8}$/.test(pin)) redirect("/admin/members?error=pin");
  if (siteId) assertSiteAllowed(tenant, siteId);
  // A site-bound admin cannot grant all-sites roles.
  if (!siteId && tenant.membership.siteId !== null) redirect("/admin/members?error=invalid");

  const user = await db.user.upsert({
    where: { email },
    create: { email, name, ...(pin ? { pinHash: await hashPassword(pin) } : {}) },
    update: { ...(pin ? { pinHash: await hashPassword(pin) } : {}) },
  });
  const existing = await db.membership.findFirst({ where: { userId: user.id, role, siteId } });
  if (existing) redirect("/admin/members?error=exists");
  await db.membership.create({ data: { userId: user.id, role, siteId } });
  await audit({ action: "member.added", siteId, actorId: tenant.user.id, targetType: "User", targetId: user.id, meta: { role } });
  redirect("/admin/members?ok=1");
}
