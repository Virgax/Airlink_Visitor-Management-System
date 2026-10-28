"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { clientIp } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rateLimit";
import { docHash, docLast4 } from "@/lib/crypto/docHash";
import { matchBlacklist } from "@/lib/guard/decide";
import type { PersonHit } from "@/components/ops/PersonPicker";
import { isVisitKind } from "@/lib/passes/form";
import { upsertCompanyByName } from "@/lib/server/passes";
import { loadSelfSignInGate, signVisitKey } from "@/lib/server/self-signin";
import { systemUserId } from "@/lib/server/system-user";
import { createUnannouncedVisit, securityRecipientIds } from "@/lib/server/visits";

const TOKEN_IN = /^[A-Za-z0-9_-]{16,64}$/;

function back(token: string, query: string): never {
  redirect(`/s/${encodeURIComponent(token)}?${query}`);
}

async function ip(): Promise<string> {
  return clientIp(await headers()) ?? "unknown";
}

/** Name-only directory search for the public form (ids + names, no department, no contact details). */
export async function searchPeopleAction(token: string, q: string): Promise<PersonHit[]> {
  if (typeof token !== "string" || !TOKEN_IN.test(token)) return [];
  const term = typeof q === "string" ? q.trim().replace(/\s+/g, " ") : "";
  if (term.length < 2) return [];
  const limit = await rateLimit(`self-search:ip:${await ip()}`, 120, 300);
  if (!limit.ok) return [];
  const gate = await loadSelfSignInGate(token);
  if (!gate) return [];
  const rows = await db.employee.findMany({
    where: { active: true, OR: [{ siteId: gate.site.id }, { siteId: null }], name: { contains: term, mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, department: null }));
}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const visitorSchema = z.object({
  token: z.string().regex(TOKEN_IN),
  hostEmployeeId: z.string().trim().min(1).max(64),
  visitorName: z.string().trim().min(2).max(120),
  company: optional(120),
  kind: z.string(),
  doc: optional(40),
  phone: optional(40),
});

/** Walk-in registration from the gate QR: creates a pending unannounced visit owned by the system user. */
export async function selfSignInAction(formData: FormData): Promise<void> {
  const tokenRaw = String(formData.get("token") ?? "");
  if (!TOKEN_IN.test(tokenRaw)) notFound();
  const limit = await rateLimit(`self-signin:ip:${await ip()}`, 10, 600);
  if (!limit.ok) back(tokenRaw, "error=rateLimited");
  const gate = await loadSelfSignInGate(tokenRaw);
  if (!gate) notFound();
  if (!String(formData.get("hostEmployeeId") ?? "").trim()) back(tokenRaw, "error=host");
  const parsed = visitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(tokenRaw, "error=invalid");
  const d = parsed.data;
  if (!isVisitKind(d.kind) || !gate.kinds.includes(d.kind)) back(tokenRaw, "error=invalid");
  if (d.doc && d.doc.replace(/[^0-9a-z]/gi, "").length < 5) back(tokenRaw, "error=invalid");

  const host = await db.employee.findFirst({ where: { id: d.hostEmployeeId, active: true, OR: [{ siteId: gate.site.id }, { siteId: null }] }, select: { id: true } });
  if (!host) back(tokenRaw, "error=host");

  let companyId: string | null = null;
  if (d.company) {
    const company = await upsertCompanyByName(d.company, d.kind);
    // Blocked companies get the same neutral message as blacklist hits: the visitor is sent to reception.
    if (company.blocked) back(tokenRaw, "error=reception");
    companyId = company.id;
  }
  const hash = d.doc ? docHash(d.doc, await getSecret("DOC_HASH_KEY")) : null;
  const last4 = d.doc ? docLast4(d.doc) : null;
  if (hash) {
    const rows = await db.blacklist.findMany({ where: { OR: [{ siteId: gate.site.id }, { siteId: null }], docHash: hash }, select: { id: true, siteId: true, docHash: true, plate: true, until: true } });
    const hit = matchBlacklist(rows, { docHash: hash }, gate.site.id);
    if (hit) {
      await audit({ action: "blacklist.hit", siteId: gate.site.id, actorId: null, targetType: "Blacklist", targetId: hit.id, meta: { gateId: gate.id, selfSignIn: true, visitorName: d.visitorName } });
      await notify({
        type: "blacklist_hit",
        userIds: await securityRecipientIds(gate.site.id),
        siteId: gate.site.id,
        payload: { visitorName: d.visitorName, company: d.company ?? null, gateName: gate.name, blacklistId: hit.id },
        url: "/guard",
      });
      back(tokenRaw, "error=reception");
    }
  }

  const visit = await createUnannouncedVisit({
    siteId: gate.site.id,
    gateId: gate.id,
    requestedById: await systemUserId(),
    hostEmployeeId: host.id,
    visitorName: d.visitorName,
    companyId,
    kind: d.kind,
    docHash: hash,
    docLast4: last4,
    plate: null,
    extra: { selfSignIn: true, ...(d.phone ? { phone: d.phone } : {}) },
  });
  const key = await signVisitKey(visit.id);
  redirect(`/s/${encodeURIComponent(tokenRaw)}/v/${visit.id}?k=${encodeURIComponent(key)}`);
}

const employeeSchema = z.object({
  token: z.string().regex(TOKEN_IN),
  employeeId: z.string().trim().min(1).max(64),
  pin: z.string().trim().min(4).max(12),
});

/**
 * Employee check-in / check-out with their PIN (`Employee.pinHash`, scrypt). Toggles: an open `EmployeePresence`
 * at the site is closed, otherwise a new one is opened. Rate limited per gate and per IP.
 */
export async function employeePresenceAction(formData: FormData): Promise<void> {
  const tokenRaw = String(formData.get("token") ?? "");
  if (!TOKEN_IN.test(tokenRaw)) notFound();
  const gate = await loadSelfSignInGate(tokenRaw);
  if (!gate) notFound();
  const q = (extra: string) => `mode=employee&${extra}`;
  if (!String(formData.get("employeeId") ?? "").trim()) back(tokenRaw, q("error=employee"));
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(tokenRaw, q("error=invalid"));
  const d = parsed.data;
  const [byGate, byIp] = await Promise.all([rateLimit(`presence:gate:${gate.id}`, 30, 600), rateLimit(`presence:ip:${await ip()}`, 10, 600)]);
  if (!byGate.ok || !byIp.ok) back(tokenRaw, q("error=rateLimited"));

  const employee = await db.employee.findFirst({ where: { id: d.employeeId, active: true, OR: [{ siteId: gate.site.id }, { siteId: null }] }, select: { id: true, name: true, pinHash: true } });
  if (!employee) back(tokenRaw, q("error=employee"));
  if (!employee.pinHash) back(tokenRaw, q("error=noPin"));
  if (!(await verifyPassword(d.pin, employee.pinHash))) back(tokenRaw, q("error=pin"));

  const now = new Date();
  const open = await db.employeePresence.findFirst({ where: { employeeId: employee.id, siteId: gate.site.id, leftAt: null }, orderBy: { enteredAt: "desc" }, select: { id: true } });
  if (open) {
    await db.employeePresence.update({ where: { id: open.id }, data: { leftAt: now } });
    await audit({ action: "employee.presence", siteId: gate.site.id, actorId: null, targetType: "Employee", targetId: employee.id, meta: { op: "out", gateId: gate.id, presenceId: open.id } });
    back(tokenRaw, q("ok=out"));
  }
  const created = await db.employeePresence.create({ data: { siteId: gate.site.id, gateId: gate.id, employeeId: employee.id, enteredAt: now }, select: { id: true } });
  await audit({ action: "employee.presence", siteId: gate.site.id, actorId: null, targetType: "Employee", targetId: employee.id, meta: { op: "in", gateId: gate.id, presenceId: created.id } });
  back(tokenRaw, q("ok=in"));
}
