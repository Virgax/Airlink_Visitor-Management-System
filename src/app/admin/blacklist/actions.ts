"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { docHash, docLast4, normalizeDoc, normalizePlate } from "@/lib/crypto/docHash";
import { zonedToUtc } from "@/lib/time/tz";

const schema = z.object({
  type: z.enum(["doc", "plate"]),
  value: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(500),
  until: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  siteId: z.string().optional(),
});

export async function addBlacklistAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/blacklist?error=invalid");
  const { type, value, name, reason, until } = parsed.data;
  const siteId = parsed.data.siteId ? parsed.data.siteId : null;
  if (siteId) assertSiteAllowed(tenant, siteId);
  // A site-bound admin cannot add global entries.
  if (!siteId && tenant.membership.siteId !== null) redirect("/admin/blacklist?error=forbidden");

  const match = type === "doc" ? { docHash: normalizeDoc(value).length >= 4 ? docHash(value, env().DOC_HASH_KEY) : null, plate: null } : { docHash: null, plate: normalizePlate(value).length >= 3 ? normalizePlate(value) : null };
  if (!match.docHash && !match.plate) redirect("/admin/blacklist?error=value");

  const site = siteId ? await db.site.findUnique({ where: { id: siteId }, select: { timezone: true } }) : null;
  const untilAt = until ? zonedToUtc(until, 23 * 60 + 59, site?.timezone ?? "America/Santo_Domingo") : null;
  if (until && !untilAt) redirect("/admin/blacklist?error=invalid");

  const duplicate = await db.blacklist.findFirst({
    where: { siteId, ...(match.docHash ? { docHash: match.docHash } : { plate: match.plate }), OR: [{ until: null }, { until: { gt: new Date() } }] },
    select: { id: true },
  });
  if (duplicate) redirect("/admin/blacklist?error=exists");

  const entry = await db.blacklist.create({
    data: { siteId, docHash: match.docHash, plate: match.plate, name: name || null, reason, until: untilAt, createdById: tenant.user.id },
  });
  await audit({
    action: "blacklist.added",
    siteId,
    actorId: tenant.user.id,
    targetType: "Blacklist",
    targetId: entry.id,
    meta: { type, last4: type === "doc" ? docLast4(value) : null, plate: match.plate, until: untilAt?.toISOString() ?? null },
  });
  redirect("/admin/blacklist?ok=added");
}

export async function removeBlacklistAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const id = String(formData.get("id") ?? "");
  const entry = await db.blacklist.findUnique({ where: { id } });
  if (!entry) redirect("/admin/blacklist?error=invalid");
  if (entry.siteId) assertSiteAllowed(tenant, entry.siteId);
  else if (tenant.membership.siteId !== null) redirect("/admin/blacklist?error=forbidden");
  await db.blacklist.delete({ where: { id } });
  await audit({ action: "blacklist.removed", siteId: entry.siteId, actorId: tenant.user.id, targetType: "Blacklist", targetId: id, meta: { plate: entry.plate, hadDoc: Boolean(entry.docHash) } });
  redirect("/admin/blacklist?ok=removed");
}
