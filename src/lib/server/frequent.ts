import "server-only";
import type { FrequentSignIn, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { docHash, docLast4 } from "@/lib/crypto/docHash";
import type { Schedule } from "@/lib/passes/validate";
import { createPass, loadPolicy, revokePass, upsertCompanyByName, type CreatePassError } from "@/lib/server/passes";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import type { FrequentHit } from "@/components/passes/FrequentPicker";

/**
 * Frequent visitors (`FrequentVisitor`): a reusable person linked to one recurring `Pass` that is active without
 * per-visit approval. The QR card and the PIN both resolve to that pass; the PIN hash is kept on the visitor and
 * mirrored onto the pass so the kiosk has a single candidate set.
 */

/** Active frequent visitors of a site by name or company (host invite form). */
export async function searchFrequentVisitors(siteId: string, q: string, limit = 10): Promise<FrequentHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await db.frequentVisitor.findMany({
    where: { siteId, active: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { company: { name: { contains: term, mode: "insensitive" } } }] },
    select: { id: true, name: true, company: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: limit,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, company: r.company?.name ?? null }));
}

export type FrequentInput = {
  siteId: string;
  name: string;
  companyName: string | null;
  /** Full document; only hash + last 4 are stored. Null keeps the current one on update. */
  doc: string | null;
  phone: string | null;
  signIn: FrequentSignIn;
  /** Plain 6-digit PIN; null keeps the current hash on update. */
  pin: string | null;
  hostEmployeeId: string;
  areaIds: string[];
  validFrom: Date;
  validUntil: Date;
  schedule: Schedule;
  note: string | null;
  /** Admin confirms the visitor accepted the visitor policy (NDA) on paper; required when the policy demands it. */
  ndaAccepted: boolean;
  actorId: string;
};

export type FrequentResult = { ok: true; id: string; passId: string } | { ok: false; error: CreatePassError | "pin_required" | "nda_required" };

/** Whether the site's recurring-pass policy demands the NDA. */
export async function frequentNeedsNda(siteId: string): Promise<boolean> {
  return evaluatePolicy(await loadPolicy(siteId, "recurring"), { kind: "recurring" }).warnings.includes("nda");
}

/** Active NDA for a site (site-specific first, then global), or null. */
async function activeNdaVersion(siteId: string): Promise<string | null> {
  const rows = await db.ndaVersion.findMany({ where: { OR: [{ siteId }, { siteId: null }], activeFrom: { lte: new Date() } }, orderBy: { activeFrom: "desc" }, select: { siteId: true, version: true } });
  return (rows.find((n) => n.siteId === siteId) ?? rows[0])?.version ?? null;
}

/** Records the NDA as accepted on the visitor's behalf (admin confirmation), audited with who confirmed it. */
async function recordNdaOnBehalf(passId: string, siteId: string, frequentId: string, actorId: string): Promise<void> {
  const now = new Date();
  const ndaVersion = await activeNdaVersion(siteId);
  await db.pass.update({ where: { id: passId }, data: { ndaAcceptedAt: now, ndaVersion } });
  await audit({ action: "nda.accepted", siteId, actorId, targetType: "Pass", targetId: passId, meta: { via: "frequent", frequentId, ndaVersion, onBehalf: true } });
}

/** Fields of the recurring pass derived from the visitor (shared by create and update). */
function passFields(input: FrequentInput) {
  return { visitorName: input.name, visitorPhone: input.phone, note: input.note, areaIds: input.areaIds, validFrom: input.validFrom, validUntil: input.validUntil, schedule: input.schedule as unknown as Prisma.InputJsonObject, hostEmployeeId: input.hostEmployeeId };
}

export async function createFrequentVisitor(input: FrequentInput): Promise<FrequentResult> {
  if (input.signIn === "pin" && !input.pin) return { ok: false, error: "pin_required" };
  const needsNda = await frequentNeedsNda(input.siteId);
  if (needsNda && !input.ndaAccepted) return { ok: false, error: "nda_required" };
  const pinHash = input.pin ? await hashPassword(input.pin) : null;
  const pass = await createPass({
    siteId: input.siteId,
    hostEmployeeId: input.hostEmployeeId,
    createdById: input.actorId,
    kind: "recurring",
    visitorName: input.name,
    companyName: input.companyName,
    visitorPhone: input.phone,
    doc: input.doc,
    note: input.note,
    areaIds: input.areaIds,
    gateIds: [],
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    schedule: input.schedule,
    groupSize: 1,
    pin: input.signIn === "pin" ? input.pin : null,
    skipApproval: true,
    auditMeta: { frequent: true },
  });
  if (!pass.ok) return pass;
  const lead = pass.passes[0]!;
  const key = await getSecret("DOC_HASH_KEY");
  const visitor = await db.frequentVisitor.create({
    data: {
      siteId: input.siteId,
      name: input.name,
      companyId: lead.companyId,
      docHash: input.doc ? docHash(input.doc, key) : null,
      docLast4: input.doc ? docLast4(input.doc) : null,
      phone: input.phone,
      signIn: input.signIn,
      pinHash: input.signIn === "pin" ? pinHash : null,
      passId: lead.id,
      createdById: input.actorId,
    },
  });
  if (needsNda) await recordNdaOnBehalf(lead.id, input.siteId, visitor.id, input.actorId);
  await audit({ action: "frequent.changed", siteId: input.siteId, actorId: input.actorId, targetType: "FrequentVisitor", targetId: visitor.id, meta: { op: "created", passId: lead.id, signIn: input.signIn, nda: needsNda } });
  return { ok: true, id: visitor.id, passId: lead.id };
}

/** Updates the visitor and its linked pass in place (a revoked/expired pass is replaced by a fresh one). */
export async function updateFrequentVisitor(id: string, input: FrequentInput): Promise<FrequentResult | { ok: false; error: "not_found" }> {
  const current = await db.frequentVisitor.findFirst({ where: { id, siteId: input.siteId }, include: { pass: true } });
  if (!current) return { ok: false, error: "not_found" };
  if (input.signIn === "pin" && !input.pin && !current.pinHash) return { ok: false, error: "pin_required" };
  const needsNda = await frequentNeedsNda(input.siteId);
  const alreadyAccepted = Boolean(current.pass?.ndaAcceptedAt);
  if (needsNda && !input.ndaAccepted && !alreadyAccepted) return { ok: false, error: "nda_required" };
  const key = await getSecret("DOC_HASH_KEY");
  const company = input.companyName ? await upsertCompanyByName(input.companyName, "recurring") : null;
  if (company?.blocked) return { ok: false, error: "company_blocked" };
  const pinHash = input.pin ? await hashPassword(input.pin) : input.signIn === "pin" ? current.pinHash : null;
  const docFields = input.doc ? { docHash: docHash(input.doc, key), docLast4: docLast4(input.doc) } : {};

  let passId = current.passId;
  const reusable = current.pass && (current.pass.status === "active" || current.pass.status === "pending_approval");
  if (reusable && current.pass) {
    await db.pass.update({
      where: { id: current.pass.id },
      data: { ...passFields(input), companyId: company?.id ?? null, status: "active", pinHash, ...(input.doc ? { visitorDocHash: docFields.docHash, visitorDocLast4: docFields.docLast4 } : {}) },
    });
    await audit({ action: "pass.updated", siteId: input.siteId, actorId: input.actorId, targetType: "Pass", targetId: current.pass.id, meta: { frequent: true, frequentId: id } });
  } else {
    const created = await createPass({
      siteId: input.siteId,
      hostEmployeeId: input.hostEmployeeId,
      createdById: input.actorId,
      kind: "recurring",
      visitorName: input.name,
      companyName: input.companyName,
      visitorPhone: input.phone,
      doc: input.doc,
      visitorDoc: !input.doc && current.docHash && current.docLast4 ? { hash: current.docHash, last4: current.docLast4 } : null,
      note: input.note,
      areaIds: input.areaIds,
      gateIds: [],
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      schedule: input.schedule,
      groupSize: 1,
      pin: input.pin,
      skipApproval: true,
      auditMeta: { frequent: true, frequentId: id },
    });
    if (!created.ok) return created;
    passId = created.passes[0]!.id;
    if (!input.pin && pinHash) await db.pass.update({ where: { id: passId }, data: { pinHash } });
  }
  if (needsNda && passId && !(reusable && alreadyAccepted)) await recordNdaOnBehalf(passId, input.siteId, id, input.actorId);

  await db.frequentVisitor.update({
    where: { id },
    data: { name: input.name, companyId: company?.id ?? null, phone: input.phone, signIn: input.signIn, pinHash, passId, active: true, ...docFields },
  });
  await audit({ action: "frequent.changed", siteId: input.siteId, actorId: input.actorId, targetType: "FrequentVisitor", targetId: id, meta: { op: "updated", passId, signIn: input.signIn, pinChanged: Boolean(input.pin) } });
  return { ok: true, id, passId: passId! };
}

/** Deactivates the visitor and revokes the linked pass; the card and PIN stop working at once. */
export async function deactivateFrequentVisitor(id: string, siteId: string, actorId: string): Promise<boolean> {
  const current = await db.frequentVisitor.findFirst({ where: { id, siteId }, select: { id: true, passId: true } });
  if (!current) return false;
  await db.frequentVisitor.update({ where: { id }, data: { active: false } });
  if (current.passId) await revokePass(current.passId, actorId);
  await audit({ action: "frequent.changed", siteId, actorId, targetType: "FrequentVisitor", targetId: id, meta: { op: "deactivated", passId: current.passId } });
  return true;
}

/** Stores the photo key after `putFile`. */
export async function setFrequentPhoto(id: string, photoKey: string): Promise<void> {
  await db.frequentVisitor.update({ where: { id }, data: { photoKey } });
}
