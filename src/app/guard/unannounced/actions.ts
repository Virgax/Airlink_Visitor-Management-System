"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { getKioskOrThrow, requireKiosk } from "@/lib/auth/kiosk";
import { docHash, docLast4, normalizePlate } from "@/lib/crypto/docHash";
import { matchBlacklist } from "@/lib/guard/decide";
import type { EmployeeHit } from "@/lib/guard/types";
import { searchEmployees } from "@/lib/server/employees-search";
import { createUnannouncedVisit, securityRecipientIds } from "@/lib/server/visits";
import { isKindEnabled } from "@/lib/server/policies";

/** Host lookup for the kiosk form (called from the HostPicker client component). */
export async function searchHostsAction(q: string): Promise<EmployeeHit[]> {
  const { site } = await getKioskOrThrow();
  return searchEmployees(typeof q === "string" ? q : "", site.id);
}

const KINDS = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"] as const;

const schema = z.object({
  hostEmployeeId: z.string().trim().min(1),
  visitorName: z.string().trim().min(2).max(120),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  kind: z.enum(KINDS),
  doc: z.string().trim().max(40).optional().or(z.literal("")),
  plate: z.string().trim().max(16).optional().or(z.literal("")),
});

export async function createUnannouncedAction(formData: FormData): Promise<void> {
  const { user, site, gate } = await requireKiosk();
  const raw = Object.fromEntries(formData);
  if (!String(raw.hostEmployeeId ?? "").trim()) redirect("/guard/unannounced?error=host");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) redirect("/guard/unannounced?error=invalid");
  const data = parsed.data;
  if (!(await isKindEnabled(site.id, data.kind))) redirect("/guard/unannounced?error=invalid");

  // The host id comes from the browser: re-check it belongs to this site (or has no site).
  const host = await db.employee.findFirst({ where: { id: data.hostEmployeeId, active: true, OR: [{ siteId: site.id }, { siteId: null }] }, select: { id: true } });
  if (!host) redirect("/guard/unannounced?error=host");

  let companyId: string | null = null;
  const companyName = data.company?.trim();
  if (companyName) {
    const company =
      (await db.company.findFirst({ where: { name: { equals: companyName, mode: "insensitive" } }, select: { id: true, blocked: true } })) ??
      (await db.company.create({ data: { name: companyName, kind: data.kind === "carrier" ? "carrier" : data.kind === "delivery" ? "courier" : "other" }, select: { id: true, blocked: true } }));
    if (company.blocked) redirect("/guard/unannounced?error=company_blocked");
    companyId = company.id;
  }

  const doc = data.doc?.trim() ?? "";
  const hash = doc ? docHash(doc, await getSecret("DOC_HASH_KEY")) : null;
  const last4 = doc ? docLast4(doc) : null;
  const plate = data.plate?.trim() ? normalizePlate(data.plate) : null;

  if (hash || plate) {
    const rows = await db.blacklist.findMany({
      where: { OR: [{ siteId: site.id }, { siteId: null }], AND: { OR: [...(hash ? [{ docHash: hash }] : []), ...(plate ? [{ plate }] : [])] } },
      select: { id: true, siteId: true, docHash: true, plate: true, until: true },
    });
    const hit = matchBlacklist(rows, { docHash: hash, plate }, site.id);
    if (hit) {
      await audit({ action: "blacklist.hit", siteId: site.id, actorId: user.id, targetType: "Blacklist", targetId: hit.id, meta: { gateId: gate.id, unannounced: true, visitorName: data.visitorName } });
      await notify({
        type: "blacklist_hit",
        userIds: await securityRecipientIds(site.id),
        siteId: site.id,
        payload: { visitorName: data.visitorName, company: companyName ?? null, gateName: gate.name, blacklistId: hit.id },
        url: "/guard",
      });
      redirect("/guard/unannounced?error=blacklisted");
    }
  }

  await createUnannouncedVisit({
    siteId: site.id,
    gateId: gate.id,
    requestedById: user.id,
    hostEmployeeId: host.id,
    visitorName: data.visitorName,
    companyId,
    kind: data.kind,
    docHash: hash,
    docLast4: last4,
    plate,
  });
  redirect("/guard/unannounced?ok=1");
}
