import type { Prisma } from "@prisma/client";

/**
 * Notification types. Payload = ids + ICU args only; the text is rendered in the reader's language when shown
 * (messages/*.json → `notifications.types.<type>`, see `render.ts`).
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

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "visit_at_gate",
  "visit_entered",
  "visit_left",
  "pass_pending_approval",
  "pass_approved",
  "pass_denied",
  "delivery_at_gate",
  "carrier_at_dock",
  "blacklist_hit",
  "visitor_overstay",
  "daily_report",
  "evacuation_list",
];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Types delivered even during the recipient's quiet hours. */
export const URGENT_TYPES: ReadonlySet<NotificationType> = new Set(["visit_at_gate", "blacklist_hit", "carrier_at_dock"]);

/** Types that are also posted to the shared Teams channel (one card per event, not per recipient). */
export const TEAMS_TYPES: ReadonlySet<NotificationType> = new Set([
  "visit_at_gate",
  "pass_pending_approval",
  "blacklist_hit",
  "carrier_at_dock",
  "delivery_at_gate",
  "visitor_overstay",
]);

/** Types delivered by email regardless of push subscriptions (scheduled reports). */
export const EMAIL_ALWAYS_TYPES: ReadonlySet<NotificationType> = new Set(["daily_report"]);

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
  /**
   * Extra e-mail recipients that are not users (e.g. `VisitPolicy.notifyEmails`): they get the message by e-mail
   * in the default language, with no stored notification and no quiet hours.
   */
  extraEmails?: string[];
};

export type NotifyResult = { stored: number };

/** Per-user options kept in `NotificationPref.prefs` (JSON). */
export type NotificationPrefs = {
  /** Send an email when the user has no push subscription. */
  emailFallback?: boolean;
  /** IANA time zone for quiet hours; falls back to the site's time zone. */
  timeZone?: string;
};

export function parsePrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    emailFallback: v.emailFallback === true,
    timeZone: typeof v.timeZone === "string" && v.timeZone.length > 0 ? v.timeZone : undefined,
  };
}
