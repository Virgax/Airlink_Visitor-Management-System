import "server-only";
import type { Pass } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";

export type PassDecision = "approved" | "denied";

/**
 * Pass approval from a Teams card (slice D). Slice B (feat/passes) owns `approvePass` / `denyPass` with the full
 * policy logic; at integration, replace the body of this function with a call to those helpers.
 *
 * Transitions a `pending_approval` Pass to `active` / `denied` atomically, audits `pass.approved` / `pass.denied`
 * and tells the host. Returns null when the pass was no longer pending.
 */
export async function decidePassFromTeams(passId: string, decision: PassDecision, byUserId: string | null): Promise<Pass | null> {
  const now = new Date();
  const res = await db.pass.updateMany({
    where: { id: passId, status: "pending_approval" },
    data: decision === "approved" ? { status: "active", approvedById: byUserId, approvedAt: now } : { status: "denied", approvedById: byUserId, approvedAt: now },
  });
  if (res.count === 0) return null;
  const pass = await db.pass.findUniqueOrThrow({ where: { id: passId }, include: { company: { select: { name: true } } } });
  await audit({
    action: decision === "approved" ? "pass.approved" : "pass.denied",
    siteId: pass.siteId,
    actorId: byUserId,
    targetType: "Pass",
    targetId: pass.id,
    meta: { via: "teams" },
  });
  await notify({
    type: decision === "approved" ? "pass_approved" : "pass_denied",
    employeeIds: [pass.hostEmployeeId],
    siteId: pass.siteId,
    payload: { passId: pass.id, visitorName: pass.visitorName, company: pass.company?.name ?? "" },
  });
  return pass;
}
