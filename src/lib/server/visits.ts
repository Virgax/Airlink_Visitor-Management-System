import "server-only";
import type { Prisma, VisitKind, VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { entryStatus } from "@/lib/guard/decide";
import { listAnswers, readAnswers } from "@/lib/forms/schema";

export class VisitError extends Error {
  constructor(public readonly code: "not_found" | "bad_state") {
    super(code);
  }
}

export const visitSummarySelect = {
  id: true,
  siteId: true,
  gateId: true,
  passId: true,
  visitorName: true,
  docLast4: true,
  plate: true,
  kind: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  enteredAt: true,
  leftAt: true,
  badgeNo: true,
  areaIds: true,
  conflict: true,
  extra: true,
  company: { select: { id: true, name: true } },
  host: { select: { id: true, name: true, department: true } },
  gate: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.VisitSelect;

export type VisitSummary = Prisma.VisitGetPayload<{ select: typeof visitSummarySelect }>;

/** JSON-safe view of a visit for the kiosk (dates as ISO strings). */
export function visitJson(v: VisitSummary) {
  return {
    id: v.id,
    passId: v.passId,
    visitorName: v.visitorName,
    docLast4: v.docLast4,
    plate: v.plate,
    kind: v.kind,
    status: v.status,
    company: v.company?.name ?? null,
    host: v.host?.name ?? null,
    hostDepartment: v.host?.department ?? null,
    gate: v.gate.name,
    createdAt: v.createdAt.toISOString(),
    decidedAt: v.decidedAt?.toISOString() ?? null,
    enteredAt: v.enteredAt?.toISOString() ?? null,
    leftAt: v.leftAt?.toISOString() ?? null,
    badgeNo: v.badgeNo,
    conflict: v.conflict,
    answers: listAnswers(readAnswers(v.extra)).map((a) => ({ id: a.id, label: a.label, value: a.value })),
  };
}

export type VisitJson = ReturnType<typeof visitJson>;

/** Users who receive security alerts for a site: security staff and admins of that site or of every site. */
export async function securityRecipientIds(siteId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { status: "active", memberships: { some: { status: "active", role: { in: ["security", "admin"] }, OR: [{ siteId }, { siteId: null }] } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Marks a visit as entered (inside, or at_dock for carriers), audits and notifies the host. */
export async function enterVisit(visitId: string, siteId: string, actorId: string, at = new Date(), opts: { allowPending?: boolean } = {}): Promise<VisitSummary> {
  const current = await db.visit.findFirst({ where: { id: visitId, siteId }, select: { id: true, status: true, kind: true } });
  if (!current) throw new VisitError("not_found");
  // A pending (unannounced) visit only enters through decideVisit(..., { enter: true }) so the approval is audited.
  if (current.status !== "approved" && !(current.status === "pending" && opts.allowPending)) throw new VisitError("bad_state");
  const status = entryStatus(current.kind);
  const visit = await db.visit.update({
    where: { id: visitId },
    data: { status, enteredAt: at, decidedById: current.status === "pending" ? actorId : undefined, decidedAt: current.status === "pending" ? at : undefined },
    select: visitSummarySelect,
  });
  await audit({ action: "visit.entered", siteId, actorId, targetType: "Visit", targetId: visit.id, meta: { status, gateId: visit.gateId, kind: visit.kind } });
  await notifyEntered(visit);
  return visit;
}

export async function notifyEntered(visit: VisitSummary): Promise<void> {
  if (!visit.host) return;
  await notify({
    type: visit.status === "at_dock" ? "carrier_at_dock" : "visit_entered",
    employeeIds: [visit.host.id],
    siteId: visit.siteId,
    payload: { visitId: visit.id, visitorName: visit.visitorName, company: visit.company?.name ?? null, gateName: visit.gate.name, kind: visit.kind, plate: visit.plate },
    url: "/app",
  });
}

/** Check-out: inside/at_dock → left. Audits `visit.left` and notifies the host. */
export async function checkoutVisit(visitId: string, siteId: string, actorId: string, at = new Date()): Promise<VisitSummary> {
  const current = await db.visit.findFirst({ where: { id: visitId, siteId }, select: { id: true, status: true } });
  if (!current) throw new VisitError("not_found");
  if (current.status !== "inside" && current.status !== "at_dock") throw new VisitError("bad_state");
  const visit = await db.visit.update({ where: { id: visitId }, data: { status: "left", leftAt: at }, select: visitSummarySelect });
  await audit({ action: "visit.left", siteId, actorId, targetType: "Visit", targetId: visit.id, meta: { from: current.status, gateId: visit.gateId } });
  if (visit.host) {
    await notify({
      type: "visit_left",
      employeeIds: [visit.host.id],
      siteId,
      payload: { visitId: visit.id, visitorName: visit.visitorName, company: visit.company?.name ?? null, gateName: visit.gate.name },
      url: "/app",
    });
  }
  return visit;
}

export type VisitDecision = "approved" | "denied";

export type DecideOptions = {
  siteId?: string;
  /** Guard override: register the entry right after approving. */
  enter?: boolean;
  reason?: string;
  /** Host note, e.g. "on_my_way" (slice D). */
  note?: string;
  /** Where the decision came from. */
  via?: "app" | "teams" | "kiosk";
};

/**
 * Host/approver, Teams or guard decision on a pending (unannounced) visit. The transition is atomic
 * (`updateMany … WHERE status = pending`): returns null when the visit was no longer pending (already decided
 * or timed out) or does not exist. Audits `visit.approved` / `visit.denied`. With `enter: true` the guard
 * override registers the entry at once. `byUserId` is null for signed Teams actions.
 */
export async function decideVisit(
  visitId: string,
  decision: VisitDecision,
  byUserId: string | null,
  opts: DecideOptions = {},
): Promise<VisitSummary | null> {
  const now = new Date();
  const res = await db.visit.updateMany({
    where: { id: visitId, status: "pending", ...(opts.siteId ? { siteId: opts.siteId } : {}) },
    data: { status: decision, decidedById: byUserId, decidedAt: now },
  });
  if (res.count === 0) return null;
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId }, select: visitSummarySelect });
  await audit({
    action: decision === "approved" ? "visit.approved" : "visit.denied",
    siteId: visit.siteId,
    actorId: byUserId,
    targetType: "Visit",
    targetId: visit.id,
    meta: { via: opts.via ?? "app", inPerson: Boolean(opts.enter), reason: opts.reason ?? null, ...(opts.note ? { note: opts.note } : {}) },
  });
  if (decision === "approved" && opts.enter && byUserId) return enterVisit(visit.id, visit.siteId, byUserId, now, { allowPending: false });
  return visit;
}

/** Whether `user` may decide on `visit`: its host (linked employee) or security/admin staff of that site. */
export async function canDecideVisit(user: { id: string; employeeId: string | null }, visit: { siteId: string; hostEmployeeId: string | null }): Promise<boolean> {
  if (visit.hostEmployeeId && user.employeeId === visit.hostEmployeeId) return true;
  const staff = await db.membership.findFirst({
    where: { userId: user.id, status: "active", role: { in: ["security", "admin"] }, OR: [{ siteId: visit.siteId }, { siteId: null }] },
    select: { id: true },
  });
  return staff !== null;
}

const OPEN_STATUSES: VisitStatus[] = ["inside", "at_dock"];

/** Visitors currently on site (inside or at the dock), newest first. */
export async function listOpenVisits(siteId: string): Promise<VisitSummary[]> {
  return db.visit.findMany({ where: { siteId, status: { in: OPEN_STATUSES } }, select: visitSummarySelect, orderBy: { enteredAt: "desc" } });
}

/** Unannounced visits waiting at the gate: pending and approved (not yet entered), plus denials of the last 15 minutes. */
export async function listGateVisits(siteId: string): Promise<VisitSummary[]> {
  const since = new Date(Date.now() - 12 * 3_600_000);
  const deniedSince = new Date(Date.now() - 15 * 60_000);
  return db.visit.findMany({
    where: {
      siteId,
      passId: null,
      OR: [
        { status: { in: ["pending", "approved"] }, createdAt: { gte: since } },
        { status: "denied", decidedAt: { gte: deniedSince } },
      ],
    },
    select: visitSummarySelect,
    orderBy: { createdAt: "desc" },
  });
}

export type EvacuationGroup = { area: string; visits: VisitSummary[] };

/** Everyone inside grouped by area (first area of the visit) and, inside each area, by host. */
export async function evacuationGroups(siteId: string, noAreaLabel: string): Promise<{ total: number; groups: EvacuationGroup[] }> {
  const [visits, areas] = await Promise.all([listOpenVisits(siteId), db.area.findMany({ where: { siteId }, select: { id: true, name: true } })]);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const byArea = new Map<string, VisitSummary[]>();
  for (const v of visits) {
    const key = (v.areaIds[0] && areaName.get(v.areaIds[0])) || (v.status === "at_dock" ? v.gate.name : noAreaLabel);
    const list = byArea.get(key) ?? [];
    list.push(v);
    byArea.set(key, list);
  }
  const groups = [...byArea.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, list]) => ({ area, visits: list.sort((a, b) => (a.host?.name ?? "").localeCompare(b.host?.name ?? "") || a.visitorName.localeCompare(b.visitorName)) }));
  return { total: visits.length, groups };
}

export type UnannouncedInput = {
  siteId: string;
  gateId: string;
  requestedById: string;
  hostEmployeeId: string;
  visitorName: string;
  companyId: string | null;
  kind: VisitKind;
  docHash: string | null;
  docLast4: string | null;
  plate: string | null;
  /** Custom answers of the kiosk form (`Visit.extra`). */
  extra?: Prisma.InputJsonObject | null;
};

/** Creates a pending visit for someone who arrived without a pass and notifies the host (`visit_at_gate`). */
export async function createUnannouncedVisit(input: UnannouncedInput): Promise<VisitSummary> {
  const visit = await db.visit.create({
    data: {
      siteId: input.siteId,
      gateId: input.gateId,
      requestedById: input.requestedById,
      hostEmployeeId: input.hostEmployeeId,
      visitorName: input.visitorName,
      companyId: input.companyId,
      kind: input.kind,
      docHash: input.docHash,
      docLast4: input.docLast4,
      plate: input.plate,
      status: "pending",
      extra: input.extra ?? undefined,
    },
    select: visitSummarySelect,
  });
  await notify({
    type: "visit_at_gate",
    employeeIds: [input.hostEmployeeId],
    siteId: input.siteId,
    payload: { visitId: visit.id, visitorName: visit.visitorName, company: visit.company?.name ?? null, gateName: visit.gate.name, kind: visit.kind },
    url: "/app/approvals",
  });
  return visit;
}
