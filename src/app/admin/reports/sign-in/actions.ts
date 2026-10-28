"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { assertSiteAllowed } from "@/lib/auth/guards";
import { getReportsTenantOrThrow } from "@/lib/auth/reports-access";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { docHash, docLast4, normalizePlate } from "@/lib/crypto/docHash";
import { matchBlacklist } from "@/lib/guard/decide";
import type { PersonHit } from "@/components/ops/PersonPicker";
import { isVisitKind } from "@/lib/passes/form";
import { searchEmployees } from "@/lib/server/employees";
import { upsertCompanyByName } from "@/lib/server/passes";
import { isKindEnabled } from "@/lib/server/policies";
import { createUnannouncedVisit, decideVisit, securityRecipientIds } from "@/lib/server/visits";

const PAGE = "/admin/reports/sign-in";

/** Host lookup for the manual sign-in form (admin or security web session, scoped to the chosen site). */
export async function searchHostsAdminAction(siteId: string, q: string): Promise<PersonHit[]> {
  const tenant = await getReportsTenantOrThrow();
  if (typeof siteId !== "string" || !siteId) return [];
  assertSiteAllowed(tenant, siteId);
  const hits = await searchEmployees(siteId, typeof q === "string" ? q : "", { limit: 10 });
  return hits.map((h) => ({ id: h.id, name: h.name, department: h.department }));
}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const schema = z.object({
  siteId: z.string().min(1).max(64),
  gateId: z.string().min(1).max(64),
  hostEmployeeId: z.string().trim().min(1).max(64),
  visitorName: z.string().trim().min(2).max(120),
  company: optional(120),
  kind: z.string(),
  doc: optional(40),
  plate: optional(16),
});

function fail(siteId: string, error: string): never {
  redirect(`${PAGE}?siteId=${encodeURIComponent(siteId)}&error=${error}`);
}

/**
 * Manual sign-in from the admin panel (reception PC without a kiosk): creates the unannounced visit and enters
 * it at once as an in-person approval by the signed-in user (`decideVisit … via: "admin"`), fully audited.
 */
export async function manualSignInAction(formData: FormData): Promise<void> {
  const tenant = await getReportsTenantOrThrow();
  const raw = Object.fromEntries(formData);
  const siteIdRaw = typeof raw.siteId === "string" ? raw.siteId : "";
  if (!String(raw.hostEmployeeId ?? "").trim()) fail(siteIdRaw, "host");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(siteIdRaw, "invalid");
  const d = parsed.data;
  if (!isVisitKind(d.kind)) fail(d.siteId, "invalid");

  // Ids posted by the browser: site against the membership, gate and host against the site.
  assertSiteAllowed(tenant, d.siteId);
  const site = tenant.sites.find((s) => s.id === d.siteId) ?? (tenant.membership.siteId === null ? await db.site.findFirst({ where: { id: d.siteId, active: true } }) : null);
  if (!site) fail(d.siteId, "invalid");
  if (!(await isKindEnabled(site.id, d.kind))) fail(site.id, "invalid");
  const gate = await db.gate.findFirst({ where: { id: d.gateId, siteId: site.id, active: true }, select: { id: true, name: true } });
  if (!gate) fail(site.id, "invalid");
  const host = await db.employee.findFirst({ where: { id: d.hostEmployeeId, active: true, OR: [{ siteId: site.id }, { siteId: null }] }, select: { id: true } });
  if (!host) fail(site.id, "host");

  let companyId: string | null = null;
  if (d.company) {
    const company = await upsertCompanyByName(d.company, d.kind);
    if (company.blocked) fail(site.id, "company_blocked");
    companyId = company.id;
  }
  const hash = d.doc ? docHash(d.doc, await getSecret("DOC_HASH_KEY")) : null;
  const last4 = d.doc ? docLast4(d.doc) : null;
  const plate = d.plate ? normalizePlate(d.plate) : null;
  if (hash || plate) {
    const rows = await db.blacklist.findMany({
      where: { OR: [{ siteId: site.id }, { siteId: null }], AND: { OR: [...(hash ? [{ docHash: hash }] : []), ...(plate ? [{ plate }] : [])] } },
      select: { id: true, siteId: true, docHash: true, plate: true, until: true },
    });
    const hit = matchBlacklist(rows, { docHash: hash, plate }, site.id);
    if (hit) {
      await audit({ action: "blacklist.hit", siteId: site.id, actorId: tenant.user.id, targetType: "Blacklist", targetId: hit.id, meta: { gateId: gate.id, manual: true, visitorName: d.visitorName } });
      await notify({ type: "blacklist_hit", userIds: await securityRecipientIds(site.id), siteId: site.id, payload: { visitorName: d.visitorName, company: d.company ?? null, gateName: gate.name, blacklistId: hit.id }, url: "/guard" });
      fail(site.id, "blacklisted");
    }
  }

  const visit = await createUnannouncedVisit({
    siteId: site.id,
    gateId: gate.id,
    requestedById: tenant.user.id,
    hostEmployeeId: host.id,
    visitorName: d.visitorName,
    companyId,
    kind: d.kind,
    docHash: hash,
    docLast4: last4,
    plate,
  });
  const entered = await decideVisit(visit.id, "approved", tenant.user.id, { siteId: site.id, enter: true, via: "admin" });
  if (!entered) fail(site.id, "invalid");
  redirect(`${PAGE}?siteId=${encodeURIComponent(site.id)}&ok=${encodeURIComponent(visit.id)}`);
}
