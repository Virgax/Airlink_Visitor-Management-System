"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { ensureEmployeeForUser } from "@/lib/server/employees-link";
import { ownPassWhere } from "@/lib/server/host-passes";
import { createPass, revokePass } from "@/lib/server/passes";
import { isKindEnabled } from "@/lib/server/policies";
import { buildSchedule, checkWindowRange, isVisitKind, parseGroupSize, uniqueIds } from "@/lib/passes/form";
import { generatePin } from "@/lib/people/pin";
import { readPinFlash, sendPassInviteEmail, setPinFlash } from "@/lib/server/invites";
import { searchFrequentVisitors } from "@/lib/server/frequent";
import { rateLimit } from "@/lib/rateLimit";
import { zonedToUtc } from "@/lib/time/tz";
import type { FrequentHit } from "@/components/passes/FrequentPicker";

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const schema = z.object({
  siteId: z.string().min(1).max(64),
  kind: z.string(),
  visitorName: z.string().trim().min(2).max(120),
  company: optional(120),
  phone: optional(40),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success),
  doc: optional(40),
  plate: optional(20),
  note: optional(500),
  escortEmployeeId: optional(64),
  mode: z.enum(["once", "recurring"]).default("once"),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
  scheduleFrom: optional(5),
  scheduleTo: optional(5),
  groupSize: z.string().optional(),
  generatePin: z.string().optional(),
  frequentId: optional(64),
});

function fail(siteId: string, error: string): never {
  redirect(`/app/passes/new?siteId=${encodeURIComponent(siteId)}&error=${error}`);
}

export async function createPassAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("host");
  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const siteIdRaw = typeof raw.siteId === "string" ? raw.siteId : "";
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(siteIdRaw, "invalid");
  const d = parsed.data;
  if (!isVisitKind(d.kind)) fail(d.siteId, "invalid");

  // The site posted by the browser is re-checked against the membership.
  assertSiteAllowed(tenant, d.siteId);
  const site = await db.site.findFirst({ where: { id: d.siteId, active: true } });
  if (!site) fail(d.siteId, "site");
  if (!(await isKindEnabled(site.id, d.kind))) fail(site.id, "invalid");

  const validFrom = zonedToUtc(d.validFrom, site.timezone);
  const validUntil = zonedToUtc(d.validUntil, site.timezone);
  if (!validFrom || !validUntil) fail(site.id, "invalid");
  const windowError = checkWindowRange(validFrom, validUntil, new Date());
  if (windowError) fail(site.id, windowError);

  const recurring = d.kind === "recurring" || d.mode === "recurring";
  const schedule = recurring ? buildSchedule({ days: formData.getAll("days"), from: d.scheduleFrom, to: d.scheduleTo }) : null;
  if (recurring && !schedule) fail(site.id, "schedule");

  // Ids posted by the browser are only kept when they belong to this site.
  const areaIds = uniqueIds(formData.getAll("areaIds"));
  const gateIds = uniqueIds(formData.getAll("gateIds"));
  const [areas, gates] = await Promise.all([
    areaIds.length ? db.area.findMany({ where: { id: { in: areaIds }, siteId: site.id, active: true }, select: { id: true } }) : [],
    gateIds.length ? db.gate.findMany({ where: { id: { in: gateIds }, siteId: site.id, active: true }, select: { id: true } }) : [],
  ]);
  const escort = d.escortEmployeeId ? await db.employee.findFirst({ where: { id: d.escortEmployeeId, active: true }, select: { id: true } }) : null;

  const host = await ensureEmployeeForUser(tenant.user);
  const t = await getTranslations("host.new");

  // A frequent visitor picked in the form: copy the hashed document (never re-typed) when no document was given.
  const frequent = d.frequentId ? await db.frequentVisitor.findFirst({ where: { id: d.frequentId, siteId: site.id, active: true }, select: { docHash: true, docLast4: true } }) : null;
  const pin = d.generatePin === "on" ? generatePin() : null;

  const result = await createPass({
    siteId: site.id,
    hostEmployeeId: host.id,
    createdById: tenant.user.id,
    kind: d.kind,
    visitorName: d.visitorName,
    companyName: d.company,
    visitorPhone: d.phone,
    visitorEmail: d.email,
    doc: d.doc,
    plate: d.plate,
    note: d.note,
    areaIds: areas.map((a) => a.id),
    escortEmployeeId: escort?.id ?? null,
    gateIds: gates.map((g) => g.id),
    validFrom,
    validUntil,
    schedule,
    groupSize: parseGroupSize(d.groupSize),
    groupPlaceholder: t("groupPlaceholder"),
    visitorDoc: frequent?.docHash && frequent.docLast4 ? { hash: frequent.docHash, last4: frequent.docLast4 } : null,
    pin,
  });
  if (!result.ok) fail(site.id, result.error);
  const lead = result.passes[0]!;
  if (pin) await setPinFlash(lead.id, pin);
  redirect(`/app/passes/${lead.id}?ok=${result.passes.length > 1 ? "createdGroup" : "created"}`);
}

/** Frequent-visitor lookup for the invite form (called from the FrequentPicker client component). */
export async function searchFrequentAction(siteId: string, q: string): Promise<FrequentHit[]> {
  const tenant = await getMembershipOrThrow("host");
  if (typeof siteId !== "string" || !siteId) return [];
  assertSiteAllowed(tenant, siteId);
  return searchFrequentVisitors(siteId, typeof q === "string" ? q : "");
}

const emailSchema = z.object({ passId: z.string().min(1).max(64), email: z.string().trim().toLowerCase().email().max(200) });

/** Sends the invitation e-mail (link + QR inline + window + instructions + NDA note) to the visitor. */
export async function emailPassAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("host");
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  const passId = String(formData.get("passId") ?? "");
  if (!parsed.success) redirect(`/app/passes/${encodeURIComponent(passId)}?error=email_invalid`);
  const pass = await loadOwnPassId(parsed.data.passId);
  const limit = await rateLimit(`pass-email:user:${tenant.user.id}`, 20, 600);
  if (!limit.ok) redirect(`/app/passes/${pass.id}?error=email_rateLimited`);
  const pin = await readPinFlash(pass.id);
  const res = await sendPassInviteEmail({ passId: pass.id, to: parsed.data.email, locale: tenant.user.locale ?? "es", pin, actorId: tenant.user.id });
  if (!res.ok) redirect(`/app/passes/${pass.id}?error=${res.error === "not_open" || res.error === "email_not_configured" ? `email_${res.error}` : "email_failed"}`);
  redirect(`/app/passes/${pass.id}?ok=emailed`);
}

async function loadOwnPassId(passId: unknown): Promise<{ id: string; siteId: string }> {
  const tenant = await getMembershipOrThrow("host");
  const id = typeof passId === "string" ? passId : "";
  const pass = await db.pass.findFirst({ where: { id, ...ownPassWhere(tenant) }, select: { id: true, siteId: true } });
  if (!pass) redirect("/app");
  assertSiteAllowed(tenant, pass.siteId);
  return pass;
}

export async function revokePassAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("host");
  const pass = await loadOwnPassId(formData.get("passId"));
  await revokePass(pass.id, tenant.user.id);
  redirect(`/app/passes/${pass.id}?ok=revoked`);
}

const renameSchema = z.object({ passId: z.string().min(1), visitorName: z.string().trim().min(2).max(120) });

/** Group members start as "Visitante N"; the host renames them here. */
export async function renamePassAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("host");
  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/app?error=invalid");
  const pass = await loadOwnPassId(parsed.data.passId);
  await db.pass.update({ where: { id: pass.id }, data: { visitorName: parsed.data.visitorName } });
  await audit({ action: "pass.updated", siteId: pass.siteId, actorId: tenant.user.id, targetType: "Pass", targetId: pass.id, meta: { field: "visitorName" } });
  redirect(`/app/passes/${pass.id}?ok=renamed`);
}
