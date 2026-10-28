"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getMembershipOrThrow, type Tenant } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { formElementsSchema } from "@/lib/forms/schema";
import { canEditTemplate, templateMediaSite, templateWhereForTenant } from "@/lib/server/forms";
import { getManagedSite } from "@/lib/server/sites";
import { mediaConfigured, mediaKey, putFile, putPdf, sniffMedia } from "@/lib/media/putFile";
import { randomToken } from "@/lib/crypto/tokens";

const LIST = "/admin/forms";
const name = z.string().trim().min(2).max(80);

async function loadEditable(tenant: Tenant, idRaw: unknown) {
  const id = typeof idRaw === "string" ? idRaw : "";
  const template = id ? await db.formTemplate.findFirst({ where: { id, ...templateWhereForTenant(tenant) } }) : null;
  if (!template || !canEditTemplate(tenant, template)) redirect(`${LIST}?error=forbidden`);
  return template;
}

export async function createTemplateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = z.object({ name, siteId: z.string().max(64).default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${LIST}?error=invalid`);
  let siteId: string | null = null;
  if (parsed.data.siteId) {
    const site = await getManagedSite(tenant, parsed.data.siteId);
    if (!site) redirect(`${LIST}?error=invalid`);
    siteId = site.id;
  } else if (tenant.membership.siteId !== null) {
    // Site-bound admins cannot create shared templates.
    redirect(`${LIST}?error=forbidden`);
  }
  const template = await db.formTemplate.create({ data: { name: parsed.data.name, siteId, elements: [] } });
  await audit({ action: "form.changed", siteId, actorId: tenant.user.id, targetType: "FormTemplate", targetId: template.id, meta: { op: "created", name: template.name } });
  redirect(`${LIST}/${template.id}?ok=created`);
}

export async function duplicateTemplateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const id = typeof formData.get("id") === "string" ? String(formData.get("id")) : "";
  const source = id ? await db.formTemplate.findFirst({ where: { id, ...templateWhereForTenant(tenant) } }) : null;
  if (!source) redirect(`${LIST}?error=forbidden`);
  // A site-bound admin duplicating a shared template gets a copy for their own site.
  const siteId = source.siteId ?? (tenant.membership.siteId === null ? null : (tenant.site?.id ?? tenant.sites[0]?.id ?? null));
  const t = await getTranslations("forms.list");
  const copy = await db.formTemplate.create({ data: { name: t("copyName", { name: source.name }).slice(0, 80), siteId, elements: source.elements as Prisma.InputJsonValue } });
  await audit({ action: "form.changed", siteId, actorId: tenant.user.id, targetType: "FormTemplate", targetId: copy.id, meta: { op: "duplicated", from: source.id } });
  redirect(`${LIST}/${copy.id}?ok=duplicated`);
}

export async function renameTemplateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const template = await loadEditable(tenant, formData.get("id"));
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) redirect(`${LIST}?error=invalid`);
  await db.formTemplate.update({ where: { id: template.id }, data: { name: parsed.data } });
  await audit({ action: "form.changed", siteId: template.siteId, actorId: tenant.user.id, targetType: "FormTemplate", targetId: template.id, meta: { op: "renamed", name: parsed.data } });
  redirect(`${LIST}?ok=renamed`);
}

export async function toggleTemplateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const template = await loadEditable(tenant, formData.get("id"));
  const active = !template.active;
  await db.formTemplate.update({ where: { id: template.id }, data: { active } });
  await audit({ action: "form.changed", siteId: template.siteId, actorId: tenant.user.id, targetType: "FormTemplate", targetId: template.id, meta: { op: active ? "activated" : "deactivated" } });
  redirect(`${LIST}?ok=${active ? "activated" : "deactivated"}`);
}

/** Saves the element list from the editor (JSON in the `elements` field), validated by the shared schema. */
export async function saveTemplateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const template = await loadEditable(tenant, formData.get("id"));
  const back = `${LIST}/${template.id}`;
  let json: unknown;
  try {
    json = JSON.parse(String(formData.get("elements") ?? "[]"));
  } catch {
    redirect(`${back}?error=invalid`);
  }
  const parsed = formElementsSchema.safeParse(json);
  if (!parsed.success) redirect(`${back}?error=invalid`);
  const elements = parsed.data;
  // Media keys must belong to this template's site (or the shared bucket folder).
  const prefix = `s/${templateMediaSite(template)}/forms/`;
  if (elements.some((e) => e.type === "media" && e.mediaKey && !e.mediaKey.startsWith(prefix))) redirect(`${back}?error=invalid`);
  const newName = formData.get("name");
  const renamed = typeof newName === "string" && name.safeParse(newName).success ? newName.trim() : template.name;
  await db.formTemplate.update({ where: { id: template.id }, data: { elements: elements as unknown as Prisma.InputJsonValue, name: renamed } });
  await audit({
    action: "form.changed",
    siteId: template.siteId,
    actorId: tenant.user.id,
    targetType: "FormTemplate",
    targetId: template.id,
    meta: { op: "saved", name: renamed, elements: elements.map((e) => ({ id: e.id, type: e.type, showOn: e.showOn })) },
  });
  redirect(`${back}?ok=saved`);
}

export type UploadResult = { ok: true; key: string; mediaType: "image" | "pdf" } | { ok: false; error: "forbidden" | "invalid" | "too_large" | "not_configured" };

const MAX_UPLOAD = 8 * 1024 * 1024;

/** Media for a `media` element (image or PDF), stored under `s/<site|all>/forms/`. Called from the editor. */
export async function uploadFormMediaAction(formData: FormData): Promise<UploadResult> {
  const tenant = await getMembershipOrThrow("admin");
  const id = typeof formData.get("id") === "string" ? String(formData.get("id")) : "";
  const template = id ? await db.formTemplate.findFirst({ where: { id, ...templateWhereForTenant(tenant) } }) : null;
  if (!template || !canEditTemplate(tenant, template)) return { ok: false, error: "forbidden" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "invalid" };
  if (file.size > MAX_UPLOAD) return { ok: false, error: "too_large" };
  if (!mediaConfigured()) return { ok: false, error: "not_configured" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffMedia(bytes);
  if (!type) return { ok: false, error: "invalid" };
  const key = mediaKey(templateMediaSite(template), "forms", `${template.id}-${randomToken(6)}`, type);
  if (type === "application/pdf") await putPdf(key, bytes);
  else await putFile(key, bytes, type);
  await audit({ action: "form.changed", siteId: template.siteId, actorId: tenant.user.id, targetType: "FormTemplate", targetId: template.id, meta: { op: "media_uploaded", key } });
  return { ok: true, key, mediaType: type === "application/pdf" ? "pdf" : "image" };
}
