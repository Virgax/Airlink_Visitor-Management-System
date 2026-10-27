import "server-only";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth/session";
import { log } from "@/lib/log";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.kiosk_login"
  | "auth.totp_enrolled"
  | "user.provisioned"
  | "site.created"
  | "site.settings_changed"
  | "gate.changed"
  | "area.changed"
  | "policy.changed"
  | "company.changed"
  | "employee.changed"
  | "member.added"
  | "member.disabled"
  | "device.created"
  | "device.enrolled"
  | "employee.synced"
  | "pass.created"
  | "pass.approved"
  | "pass.denied"
  | "pass.revoked"
  | "pass.updated"
  | "nda.accepted"
  | "visit.approved"
  | "visit.denied"
  | "visit.entered"
  | "visit.left"
  | "blacklist.hit"
  | "blacklist.added"
  | "blacklist.removed"
  | "shift.incident"
  | "report.exported";

/** Writes an audit entry; never throws (audit must not break the main action). */
export async function audit(input: {
  action: AuditAction;
  siteId?: string | null;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  meta?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      ip = clientIp(await headers());
    } catch {
      // not in a request context (cron, seed)
    }
    await db.auditLog.create({
      data: {
        action: input.action,
        siteId: input.siteId ?? null,
        actorId: input.actorId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        meta: input.meta,
        ip,
      },
    });
  } catch (err) {
    log.error("audit.failed", { action: input.action, err: String(err) });
  }
}
