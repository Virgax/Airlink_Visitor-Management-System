"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { getManagedSite, isValidTimeZone, readSiteSettings } from "@/lib/server/sites";

const nameSchema = z.string().trim().min(2).max(80);
const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40);
const timezoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone);

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
const on = (formData: FormData, key: string) => formData.get(key) === "on";
const field = (formData: FormData, key: string) => String(formData.get(key) ?? "");

const createSchema = z.object({ name: nameSchema, slug: slugSchema, address: z.string().trim().max(200).optional(), timezone: timezoneSchema });

export async function createSiteAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  if (tenant.membership.siteId !== null) redirect("/admin/sites?error=forbidden");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/admin/sites?error=${parsed.error.issues.some((i) => i.path[0] === "timezone") ? "timezone" : "invalid"}`);
  const { name, slug, address, timezone } = parsed.data;
  let siteId: string;
  try {
    const site = await db.site.create({ data: { name, slug, address: address || null, timezone, settings: { retentionDays: 90, unannouncedTimeoutMin: 5 } } });
    siteId = site.id;
  } catch (err) {
    if (isUnique(err)) redirect("/admin/sites?error=exists");
    throw err;
  }
  await audit({ action: "site.created", siteId, actorId: tenant.user.id, targetType: "Site", targetId: siteId, meta: { name, slug } });
  redirect(`/admin/sites/${siteId}?ok=created`);
}

const updateSchema = z.object({
  siteId: z.string().min(1),
  name: nameSchema,
  address: z.string().trim().max(200).optional(),
  timezone: timezoneSchema,
  retentionDays: z.coerce.number().int().min(1).max(3650),
  unannouncedTimeoutMin: z.coerce.number().int().min(1).max(240),
});

export async function updateSiteAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const back = field(formData, "siteId");
    redirect(`/admin/sites/${encodeURIComponent(back)}?error=${parsed.error.issues.some((i) => i.path[0] === "timezone") ? "timezone" : "invalid"}`);
  }
  const { siteId, name, address, timezone, retentionDays, unannouncedTimeoutMin } = parsed.data;
  const site = await getManagedSite(tenant, siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const settings = { ...readSiteSettings(site), retentionDays, unannouncedTimeoutMin };
  // Only all-sites admins can deactivate a site (a site-bound admin would lock themselves out).
  const active = tenant.membership.siteId === null ? on(formData, "active") : site.active;
  await db.site.update({ where: { id: site.id }, data: { name, address: address || null, timezone, active, settings } });
  await audit({ action: "site.settings_changed", siteId: site.id, actorId: tenant.user.id, targetType: "Site", targetId: site.id, meta: { name, timezone, active, retentionDays, unannouncedTimeoutMin } });
  redirect(`/admin/sites/${site.id}?ok=saved`);
}

const gateSchema = z.object({ siteId: z.string().min(1), name: nameSchema, kind: z.enum(["pedestrian", "vehicle", "dock"]) });

export async function createGateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = gateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/admin/sites/${encodeURIComponent(field(formData, "siteId"))}?error=invalid`);
  const site = await getManagedSite(tenant, parsed.data.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const gate = await db.gate.create({ data: { siteId: site.id, name: parsed.data.name, kind: parsed.data.kind } });
  await audit({ action: "gate.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: "created", name: gate.name, kind: gate.kind } });
  redirect(`/admin/sites/${site.id}?ok=gate`);
}

export async function toggleGateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const gateId = field(formData, "gateId");
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const updated = await db.gate.update({ where: { id: gate.id }, data: { active: !gate.active } });
  await audit({ action: "gate.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: updated.active ? "activated" : "deactivated" } });
  redirect(`/admin/sites/${site.id}?ok=saved`);
}

const areaSchema = z.object({ siteId: z.string().min(1), name: nameSchema });

export async function createAreaAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = areaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/admin/sites/${encodeURIComponent(field(formData, "siteId"))}?error=invalid`);
  const site = await getManagedSite(tenant, parsed.data.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  try {
    const area = await db.area.create({ data: { siteId: site.id, name: parsed.data.name, restricted: on(formData, "restricted"), escortRequired: on(formData, "escortRequired") } });
    await audit({ action: "area.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Area", targetId: area.id, meta: { op: "created", name: area.name, restricted: area.restricted, escortRequired: area.escortRequired } });
  } catch (err) {
    if (isUnique(err)) redirect(`/admin/sites/${site.id}?error=areaExists`);
    throw err;
  }
  redirect(`/admin/sites/${site.id}?ok=area`);
}

export async function updateAreaAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const areaId = field(formData, "areaId");
  const area = await db.area.findUnique({ where: { id: areaId } });
  if (!area) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, area.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const data = { restricted: on(formData, "restricted"), escortRequired: on(formData, "escortRequired") };
  await db.area.update({ where: { id: area.id }, data });
  await audit({ action: "area.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Area", targetId: area.id, meta: { op: "updated", ...data } });
  redirect(`/admin/sites/${site.id}?ok=saved`);
}

export async function toggleAreaAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const areaId = field(formData, "areaId");
  const area = await db.area.findUnique({ where: { id: areaId } });
  if (!area) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, area.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const updated = await db.area.update({ where: { id: area.id }, data: { active: !area.active } });
  await audit({ action: "area.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Area", targetId: area.id, meta: { op: updated.active ? "activated" : "deactivated" } });
  redirect(`/admin/sites/${site.id}?ok=saved`);
}
