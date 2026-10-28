import "server-only";
import type { VisitKind } from "@prisma/client";
import { db } from "@/lib/db";
import { VISIT_KINDS } from "@/lib/passes/form";

/**
 * Visit kinds a site offers to hosts, the kiosk and the gate QR self sign-in: every kind whose policy row is
 * missing (seed defaults apply) or has `enabled = true`. Existing passes/visits of a disabled kind keep working;
 * the flag only hides the kind from the forms that create new ones.
 */
export async function enabledKinds(siteId: string): Promise<VisitKind[]> {
  const rows = await db.visitPolicy.findMany({ where: { siteId }, select: { kind: true, enabled: true } });
  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.kind));
  return VISIT_KINDS.filter((k) => !disabled.has(k));
}

export async function isKindEnabled(siteId: string, kind: VisitKind): Promise<boolean> {
  const row = await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind } }, select: { enabled: true } });
  return row ? row.enabled : true;
}

/** Extra e-mail recipients a policy names for `visit_entered` of that kind (`VisitPolicy.notifyEmails`). */
export async function policyNotifyEmails(siteId: string, kind: VisitKind): Promise<string[]> {
  const row = await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind } }, select: { notifyEmails: true } });
  return row?.notifyEmails ?? [];
}
