import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * Notification types. Payload = ids + ICU args only; the text is rendered in the reader's language when shown
 * (messages/*.json → `notifications.<type>`). Slice D (feat/notifications) implements the channels
 * (Web Push, Teams, email) behind this same function; other slices only call `notify`.
 */
export type NotificationType =
  | "visit_at_gate"
  | "visit_entered"
  | "visit_left"
  | "pass_pending_approval"
  | "pass_approved"
  | "pass_denied"
  | "delivery_at_gate"
  | "carrier_at_dock"
  | "blacklist_hit"
  | "visitor_overstay"
  | "daily_report"
  | "evacuation_list";

/** Types delivered even during the recipient's quiet hours. */
export const URGENT_TYPES: ReadonlySet<NotificationType> = new Set(["visit_at_gate", "blacklist_hit", "carrier_at_dock"]);

export type NotifyInput = {
  type: NotificationType;
  /** Recipients. Either users directly or employees (resolved to their linked user, if any). */
  userIds?: string[];
  employeeIds?: string[];
  siteId?: string | null;
  /** Ids and ICU arguments for the message, e.g. { visitId, visitorName, company, gateName }. */
  payload: Prisma.InputJsonObject;
  /** Deep link opened from the notification. */
  url?: string;
};

export type NotifyResult = { stored: number };

/**
 * Stores one Notification row per recipient. Channel delivery (push/Teams/email) is added by slice D;
 * when NOTIFY_FAKE=1 nothing leaves the process (tests).
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const userIds = new Set(input.userIds ?? []);
  if (input.employeeIds?.length) {
    const users = await db.user.findMany({
      where: { employeeId: { in: input.employeeIds }, status: "active" },
      select: { id: true },
    });
    for (const u of users) userIds.add(u.id);
  }
  if (userIds.size === 0) {
    log.info("notify.no_recipients", { type: input.type, siteId: input.siteId ?? null });
    return { stored: 0 };
  }
  const payload = { ...input.payload, ...(input.url ? { url: input.url } : {}), siteId: input.siteId ?? null };
  await db.notification.createMany({
    data: [...userIds].map((userId) => ({ userId, type: input.type, payload })),
  });
  log.info("notify.stored", { type: input.type, recipients: userIds.size });
  return { stored: userIds.size };
}
