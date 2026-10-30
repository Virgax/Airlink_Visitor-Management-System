"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { getManagedSite, isValidTimeZone, readSiteSettings } from "@/lib/server/sites";
import { readGateSettings } from "@/lib/server/gates";
import { randomToken } from "@/lib/crypto/tokens";
import { isVisitKind } from "@/lib/passes/form";
import { PRINTER_KINDS, readPrinter } from "@/lib/badges/config";
import { BADGE_TEMPLATES } from "@/lib/badges/zpl";

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
  badgeTemplate: z.enum(BADGE_TEMPLATES).default("landscape_photo"),
});

export async function updateSiteAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const back = field(formData, "siteId");
    redirect(`/admin/sites/${encodeURIComponent(back)}?error=${parsed.error.issues.some((i) => i.path[0] === "timezone") ? "timezone" : "invalid"}`);
  }
  const { siteId, name, address, timezone, retentionDays, unannouncedTimeoutMin, badgeTemplate } = parsed.data;
  const site = await getManagedSite(tenant, siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const settings = { ...readSiteSettings(site), retentionDays, unannouncedTimeoutMin, badgeTemplate };
  // Only all-sites admins can deactivate a site (a site-bound admin would lock themselves out).
  const active = tenant.membership.siteId === null ? on(formData, "active") : site.active;
  await db.site.update({ where: { id: site.id }, data: { name, address: address || null, timezone, active, settings } });
  await audit({ action: "site.settings_changed", siteId: site.id, actorId: tenant.user.id, targetType: "Site", targetId: site.id, meta: { name, timezone, active, retentionDays, unannouncedTimeoutMin, badgeTemplate } });
  redirect(`/admin/sites/${site.id}?ok=saved`);
}

const gateSchema = z.object({ siteId: z.string().min(1), name: nameSchema, kind: z.enum(["pedestrian", "vehicle", "dock", "checkpoint"]) });

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

/** Deletes a gate that recorded nothing (no visits, shift log entries or presences); otherwise deactivate it. */
export async function deleteGateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const gateId = field(formData, "gateId");
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const [visits, logs, presences] = await Promise.all([
    db.visit.count({ where: { gateId: gate.id } }),
    db.shiftLog.count({ where: { gateId: gate.id } }),
    db.employeePresence.count({ where: { gateId: gate.id } }),
  ]);
  if (visits + logs + presences > 0) redirect(`/admin/sites/${site.id}?error=gateInUse#gate-${gate.id}`);
  await db.gate.delete({ where: { id: gate.id } }); // enrolled devices of the gate go with it (cascade)
  await audit({ action: "gate.deleted", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { name: gate.name, kind: gate.kind } });
  redirect(`/admin/sites/${site.id}?ok=gateDeleted`);
}

/**
 * Deletes a site and everything recorded in it (passes, visits, logs, devices, policies, forms, memberships…).
 * Irreversible, so only a company-wide admin can do it and must type the site's name. Employees and audit entries
 * keep existing without a site. Prefer deactivating a site that has history.
 */
export async function deleteSiteAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  if (tenant.membership.siteId !== null) redirect("/admin/sites?error=forbidden");
  const siteId = field(formData, "siteId");
  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) redirect("/admin/sites?error=invalid");
  const typed = field(formData, "confirmName").trim();
  if (typed !== site.name) redirect(`/admin/sites/${site.id}?error=deleteConfirm`);
  const [passes, visits] = await Promise.all([db.pass.count({ where: { siteId: site.id } }), db.visit.count({ where: { siteId: site.id } })]);
  await db.$transaction(async (tx) => {
    // Rows that reference a gate with RESTRICT go first; the rest cascades from the site.
    await tx.visit.deleteMany({ where: { siteId: site.id } });
    await tx.shiftLog.deleteMany({ where: { siteId: site.id } });
    await tx.employeePresence.deleteMany({ where: { siteId: site.id } });
    await tx.site.delete({ where: { id: site.id } });
  });
  await audit({ action: "site.deleted", siteId: null, actorId: tenant.user.id, targetType: "Site", targetId: site.id, meta: { name: site.name, slug: site.slug, passes, visits } });
  redirect("/admin/sites?ok=deleted");
}

const printerSchema = z.object({
  gateId: z.string().min(1),
  printerKind: z.enum(["none", ...PRINTER_KINDS]),
  printerName: z.string().trim().max(80).optional().or(z.literal("")),
});

/** Printer of a gate (`Gate.settings.printer`): the print agent's shared printer, Zebra Browser Print, or none. */
export async function updateGatePrinterAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = printerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/sites?error=invalid");
  const gate = await db.gate.findUnique({ where: { id: parsed.data.gateId } });
  if (!gate) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const current = gate.settings && typeof gate.settings === "object" && !Array.isArray(gate.settings) ? (gate.settings as Record<string, unknown>) : {};
  const printer = parsed.data.printerKind === "none" ? null : { kind: parsed.data.printerKind, name: parsed.data.printerName?.trim() ?? "" };
  const { printer: _old, ...rest } = current;
  const settings = (printer ? { ...rest, printer } : rest) as Prisma.InputJsonObject;
  await db.gate.update({ where: { id: gate.id }, data: { settings } });
  await audit({ action: "gate.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: "printer", printer: readPrinter({ printer }) } });
  redirect(`/admin/sites/${site.id}?ok=printer`);
}

/** Areas a checkpoint gate controls (`Gate.settings.checkpointAreaIds`); empty = any visitor inside may pass. */
export async function updateCheckpointAreasAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const gateId = field(formData, "gateId");
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate || gate.kind !== "checkpoint") redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const wanted = [...new Set(formData.getAll("checkpointAreaIds").map(String))].slice(0, 100);
  const areas = wanted.length ? await db.area.findMany({ where: { id: { in: wanted }, siteId: site.id }, select: { id: true } }) : [];
  const checkpointAreaIds = areas.map((a) => a.id);
  const settings = { ...readGateSettings(gate), checkpointAreaIds } as unknown as Prisma.InputJsonObject;
  await db.gate.update({ where: { id: gate.id }, data: { settings } });
  await audit({ action: "gate.changed", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: "checkpointAreas", checkpointAreaIds } });
  redirect(`/admin/sites/${site.id}?ok=saved#gate-${gate.id}`);
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

// ───────────────────────────── Gate QR self sign-in (slice H) ─────────────────────────────

/** Enables (new public token) or disables (token removed, the poster stops working) self sign-in for a gate. */
export async function toggleSelfSignInAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const gateId = field(formData, "gateId");
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const enable = gate.selfSignInToken === null;
  await db.gate.update({ where: { id: gate.id }, data: { selfSignInToken: enable ? randomToken(16) : null } });
  await audit({ action: "gate.self_sign_in", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: enable ? "enabled" : "disabled" } });
  redirect(`/admin/sites/${site.id}?ok=${enable ? "selfSignInOn" : "selfSignInOff"}#gate-${gate.id}`);
}

/** Which visit kinds walk-ins may pick on the public form (`Gate.settings.selfSignInKinds`; empty = every enabled kind). */
export async function updateSelfSignInKindsAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const gateId = field(formData, "gateId");
  const gate = await db.gate.findUnique({ where: { id: gateId } });
  if (!gate) redirect("/admin/sites?error=invalid");
  const site = await getManagedSite(tenant, gate.siteId);
  if (!site) redirect("/admin/sites?error=invalid");
  const kinds = [...new Set(formData.getAll("selfSignInKinds").map(String).filter(isVisitKind))];
  const settings = { ...readGateSettings(gate), selfSignInKinds: kinds };
  await db.gate.update({ where: { id: gate.id }, data: { settings } });
  await audit({ action: "gate.self_sign_in", siteId: site.id, actorId: tenant.user.id, targetType: "Gate", targetId: gate.id, meta: { op: "kinds", kinds } });
  redirect(`/admin/sites/${site.id}?ok=saved#gate-${gate.id}`);
}
