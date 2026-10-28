import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { dispatchChannels } from "@/lib/notifications/dispatch";
import { URGENT_TYPES, type NotificationType, type NotifyInput, type NotifyResult } from "@/lib/notifications/types";

/**
 * Notification types. Payload = ids + ICU args only; the text is rendered in the reader's language when shown
 * (messages/*.json → `notifications.types.<type>`, `render.ts`). Other slices only call `notify`.
 */
export type { NotificationType, NotifyInput, NotifyResult };
export { URGENT_TYPES };

/**
 * Stores one Notification row per recipient, then delivers through the channels (Web Push, Teams, email;
 * `dispatch.ts`). Channel failures are logged and never thrown. When NOTIFY_FAKE=1 nothing leaves the
 * process: channels only record what they would have sent (`fake.ts`, `__fakeOutbox`).
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
  const payload = { ...input.payload, ...(input.url ? { url: input.url } : {}), siteId: input.siteId ?? null };
  if (userIds.size === 0) {
    log.info("notify.no_recipients", { type: input.type, siteId: input.siteId ?? null });
  } else {
    await db.notification.createMany({
      data: [...userIds].map((userId) => ({ userId, type: input.type, payload })),
    });
    log.info("notify.stored", { type: input.type, recipients: userIds.size });
  }
  // Teams is a shared channel: the card goes out even when no user is a direct recipient (e.g. blacklist hits).
  await dispatchChannels({ type: input.type, siteId: input.siteId ?? null, payload, userIds: [...userIds], extraEmails: input.extraEmails ?? [] });
  return { stored: userIds.size };
}
