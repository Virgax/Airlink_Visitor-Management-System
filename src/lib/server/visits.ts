import "server-only";
import type { Visit } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export type VisitDecision = "approved" | "denied";

/**
 * Minimal host decision on an unannounced visit (slice D). Slice C (feat/guard) owns the full visit lifecycle;
 * at integration this function is expected to be kept or replaced by its equivalent with the same signature.
 *
 * Transitions a `pending` Visit to `approved` / `denied` atomically (`updateMany … WHERE status = pending`),
 * records who decided and audits `visit.approved` / `visit.denied`. Returns null when the visit was no longer
 * pending (already decided or timed out). Notifies nothing: the kiosk polls the visit status.
 */
export async function decideVisit(
  visitId: string,
  decision: VisitDecision,
  byUserId: string | null,
  opts: { note?: string; via?: "app" | "teams" } = {},
): Promise<Visit | null> {
  const now = new Date();
  const res = await db.visit.updateMany({
    where: { id: visitId, status: "pending" },
    data: { status: decision, decidedById: byUserId, decidedAt: now },
  });
  if (res.count === 0) return null;
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  await audit({
    action: decision === "approved" ? "visit.approved" : "visit.denied",
    siteId: visit.siteId,
    actorId: byUserId,
    targetType: "Visit",
    targetId: visit.id,
    meta: { via: opts.via ?? "app", ...(opts.note ? { note: opts.note } : {}) },
  });
  return visit;
}

/**
 * Whether `user` may decide on `visit`: its host (linked employee) or security/admin staff of that site.
 */
export async function canDecideVisit(user: { id: string; employeeId: string | null }, visit: { siteId: string; hostEmployeeId: string | null }): Promise<boolean> {
  if (visit.hostEmployeeId && user.employeeId === visit.hostEmployeeId) return true;
  const staff = await db.membership.findFirst({
    where: { userId: user.id, status: "active", role: { in: ["security", "admin"] }, OR: [{ siteId: visit.siteId }, { siteId: null }] },
    select: { id: true },
  });
  return staff !== null;
}
