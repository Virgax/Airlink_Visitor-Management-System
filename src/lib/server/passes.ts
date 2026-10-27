import "server-only";
import type { MembershipRole, Pass, Prisma, VisitKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { randomToken } from "@/lib/crypto/tokens";
import { docHash, docLast4, normalizePlate } from "@/lib/crypto/docHash";
import { evaluatePolicy, type PolicyInput } from "@/lib/policies/evaluate";
import type { Schedule } from "@/lib/passes/validate";
import { groupVisitorNames, RECURRING_MAX_USES } from "@/lib/passes/form";
import { qrPayloadFor as buildQrPayload, type QrPass, type QrPayloadInfo } from "@/lib/passes/qr";

/**
 * Atomically consumes one use of a pass. Returns the updated row or null when no use was left
 * (`UPDATE … WHERE uses < maxUses RETURNING`). Single-use passes flip to `used`.
 */
export async function consumePassUse(passId: string, siteId: string): Promise<{ id: string; uses: number; maxUses: number; status: string } | null> {
  const rows = await db.$queryRaw<{ id: string; uses: number; maxUses: number; status: string }[]>`
    UPDATE "Pass"
       SET "uses" = "uses" + 1,
           "status" = CASE WHEN "uses" + 1 >= "maxUses" THEN 'used'::"PassStatus" ELSE "status" END,
           "updatedAt" = NOW()
     WHERE "id" = ${passId}
       AND "siteId" = ${siteId}
       AND "status" = 'active'::"PassStatus"
       AND "uses" < "maxUses"
 RETURNING "id", "uses", "maxUses", "status"::text AS "status"`;
  return rows[0] ?? null;
}

/** Cron: marks active passes whose window ended as expired. */
export async function expirePasses(now = new Date()): Promise<number> {
  const res = await db.pass.updateMany({
    where: { status: { in: ["active", "pending_approval"] }, validUntil: { lt: now } },
    data: { status: "expired" },
  });
  return res.count;
}

/** Current QR payload for a pass (static or rotating) signed with PASS_SIGNING_KEY. */
export async function qrPayloadFor(pass: QrPass, now = new Date()): Promise<QrPayloadInfo> {
  return buildQrPayload(pass, now, await getSecret("PASS_SIGNING_KEY"));
}

/** The site's policy row for a kind, or null (callers fall back to DEFAULT_POLICIES through evaluatePolicy). */
export async function loadPolicy(siteId: string, kind: VisitKind): Promise<PolicyInput | null> {
  const row = await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind } } });
  if (!row) return null;
  const { id: _id, siteId: _s, ...policy } = row;
  return policy;
}

const COMPANY_KIND_BY_VISIT: Partial<Record<VisitKind, "vendor" | "contractor" | "client" | "carrier" | "courier">> = {
  vendor: "vendor",
  contractor: "contractor",
  recurring: "contractor",
  auditor: "client",
  carrier: "carrier",
  delivery: "courier",
};

/** Finds or creates a company by name (trimmed, case preserved on first use). */
export async function upsertCompanyByName(name: string, kind: VisitKind): Promise<{ id: string; blocked: boolean }> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const existing = await db.company.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } }, select: { id: true, blocked: true } });
  if (existing) return existing;
  return db.company.create({ data: { name: trimmed, kind: COMPANY_KIND_BY_VISIT[kind] ?? "other" }, select: { id: true, blocked: true } });
}

export type CreatePassInput = {
  siteId: string;
  hostEmployeeId: string;
  createdById: string;
  kind: VisitKind;
  visitorName: string;
  companyName?: string | null;
  visitorPhone?: string | null;
  visitorEmail?: string | null;
  /** Full document number; only its HMAC and last 4 are stored. */
  doc?: string | null;
  plate?: string | null;
  note?: string | null;
  areaIds: string[];
  escortEmployeeId?: string | null;
  gateIds: string[];
  validFrom: Date;
  validUntil: Date;
  schedule?: Schedule | null;
  groupSize: number;
  /** Placeholder for numbered group members, in the host's language. */
  groupPlaceholder?: string;
};

export type CreatePassError = "missing_doc" | "missing_plate" | "gate_not_allowed" | "company_blocked";

export type CreatePassResult =
  | { ok: true; passes: Pass[]; status: "active" | "pending_approval"; approverRole: MembershipRole | null }
  | { ok: false; error: CreatePassError };

/**
 * Creates one pass (or N passes sharing a groupId), applying the site's VisitPolicy. Pending passes notify
 * the approvers of that site (membership role = policy.approverRole, site-bound or company-wide).
 * The caller has already authorized siteId / host / escort ids.
 */
export async function createPass(input: CreatePassInput): Promise<CreatePassResult> {
  const key = await getSecret("DOC_HASH_KEY");
  const doc = input.doc?.trim() ? input.doc.trim() : null;
  const visitorDocHash = doc ? docHash(doc, key) : null;
  const visitorDocLast4 = doc ? docLast4(doc) : null;
  const plate = input.plate?.trim() ? normalizePlate(input.plate) : null;

  const policy = await loadPolicy(input.siteId, input.kind);
  const evaluation = evaluatePolicy(policy, { kind: input.kind, visitorDocHash, plate, gateIds: input.gateIds });
  if (evaluation.missing.includes("doc")) return { ok: false, error: "missing_doc" };
  if (evaluation.missing.includes("plate")) return { ok: false, error: "missing_plate" };
  if (evaluation.missing.includes("gate")) return { ok: false, error: "gate_not_allowed" };

  let companyId: string | null = null;
  if (input.companyName?.trim()) {
    const company = await upsertCompanyByName(input.companyName, input.kind);
    if (company.blocked) return { ok: false, error: "company_blocked" };
    companyId = company.id;
  }

  const names = groupVisitorNames(input.visitorName, input.groupSize, input.groupPlaceholder);
  const groupId = names.length > 1 ? randomToken(8) : null;
  const schedule = input.schedule ?? null;
  const status = evaluation.initialStatus;

  const rows: Prisma.PassCreateManyInput[] = names.map((visitorName) => ({
    siteId: input.siteId,
    hostEmployeeId: input.hostEmployeeId,
    createdById: input.createdById,
    kind: input.kind,
    companyId,
    visitorName,
    visitorPhone: input.visitorPhone?.trim() || null,
    visitorEmail: input.visitorEmail?.trim().toLowerCase() || null,
    visitorDocHash,
    visitorDocLast4,
    plate,
    areaIds: input.areaIds,
    escortEmployeeId: input.escortEmployeeId || null,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    maxUses: schedule ? RECURRING_MAX_USES : 1,
    schedule: schedule ? (schedule as unknown as Prisma.InputJsonObject) : undefined,
    gateIds: input.gateIds,
    token: randomToken(16),
    status,
    note: input.note?.trim() || null,
    groupId,
  }));

  const passes = await db.$transaction(async (tx) => {
    await tx.pass.createMany({ data: rows });
    return tx.pass.findMany({ where: { token: { in: rows.map((r) => r.token) } }, orderBy: { visitorName: "asc" } });
  });
  // Keep the lead (entered name) first.
  passes.sort((a, b) => rows.findIndex((r) => r.token === a.token) - rows.findIndex((r) => r.token === b.token));

  for (const pass of passes) {
    await audit({
      action: "pass.created",
      siteId: pass.siteId,
      actorId: input.createdById,
      targetType: "Pass",
      targetId: pass.id,
      meta: { kind: pass.kind, status: pass.status, groupId, warnings: evaluation.warnings },
    });
  }

  if (status === "pending_approval" && passes[0]) {
    await notifyApprovers(passes[0], evaluation.approverRole ?? "security", names.length);
  }
  return { ok: true, passes, status, approverRole: evaluation.approverRole };
}

async function notifyApprovers(pass: Pass, role: MembershipRole, groupSize: number): Promise<void> {
  const members = await db.membership.findMany({
    where: { role, status: "active", OR: [{ siteId: pass.siteId }, { siteId: null }], user: { status: "active" } },
    select: { userId: true },
  });
  const host = await db.employee.findUnique({ where: { id: pass.hostEmployeeId }, select: { name: true } });
  await notify({
    type: "pass_pending_approval",
    userIds: members.map((m) => m.userId),
    siteId: pass.siteId,
    payload: { passId: pass.id, visitorName: pass.visitorName, kind: pass.kind, hostName: host?.name ?? "", groupSize, groupId: pass.groupId },
    url: "/app/approvals",
  });
}

async function notifyHost(pass: Pass, type: "pass_approved" | "pass_denied", actorId: string): Promise<void> {
  await notify({
    type,
    userIds: [pass.createdById],
    employeeIds: [pass.hostEmployeeId],
    siteId: pass.siteId,
    payload: { passId: pass.id, visitorName: pass.visitorName, kind: pass.kind, actorId },
    url: `/app/passes/${pass.id}`,
  });
}

/** Host cancels a pass. Only active or pending passes can be revoked; others are returned unchanged. */
export async function revokePass(passId: string, actorId: string): Promise<Pass | null> {
  const res = await db.pass.updateMany({ where: { id: passId, status: { in: ["active", "pending_approval"] } }, data: { status: "revoked" } });
  const pass = await db.pass.findUnique({ where: { id: passId } });
  if (!pass) return null;
  if (res.count > 0) {
    await audit({ action: "pass.revoked", siteId: pass.siteId, actorId, targetType: "Pass", targetId: pass.id, meta: { kind: pass.kind } });
  }
  return pass;
}

/** Approver/security activates a pending pass and tells the host. */
export async function approvePass(passId: string, actorId: string): Promise<Pass | null> {
  const res = await db.pass.updateMany({
    where: { id: passId, status: "pending_approval" },
    data: { status: "active", approvedById: actorId, approvedAt: new Date() },
  });
  const pass = await db.pass.findUnique({ where: { id: passId } });
  if (!pass || res.count === 0) return pass;
  await audit({ action: "pass.approved", siteId: pass.siteId, actorId, targetType: "Pass", targetId: pass.id, meta: { kind: pass.kind } });
  await notifyHost(pass, "pass_approved", actorId);
  return pass;
}

/** Approver/security rejects a pending pass and tells the host. */
export async function denyPass(passId: string, actorId: string, reason?: string | null): Promise<Pass | null> {
  const res = await db.pass.updateMany({
    where: { id: passId, status: "pending_approval" },
    data: { status: "denied", approvedById: actorId, approvedAt: new Date() },
  });
  const pass = await db.pass.findUnique({ where: { id: passId } });
  if (!pass || res.count === 0) return pass;
  await audit({ action: "pass.denied", siteId: pass.siteId, actorId, targetType: "Pass", targetId: pass.id, meta: { kind: pass.kind, reason: reason ?? null } });
  await notifyHost(pass, "pass_denied", actorId);
  return pass;
}

/** The role that must approve a pass of this kind at this site (policy.approverRole, default security). */
export async function approverRoleFor(siteId: string, kind: VisitKind): Promise<MembershipRole> {
  const policy = await loadPolicy(siteId, kind);
  return evaluatePolicy(policy, { kind }).approverRole ?? "security";
}
