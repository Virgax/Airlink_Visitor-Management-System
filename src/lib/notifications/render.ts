import { createTranslator } from "next-intl";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import type { NotificationType } from "@/lib/notifications/types";

export type RenderedNotification = { title: string; body: string; url: string };

/** Loose payload shape: ids + ICU args as stored in `Notification.payload`. */
export type NotificationPayload = Record<string, unknown> | null | undefined;

const MESSAGES: Record<Locale, typeof es> = { es, en };

/** Every ICU argument used by `notifications.types.*` with a safe default, so a sparse payload never throws. */
const ARG_DEFAULTS: Record<string, string | number> = {
  visitorName: "—",
  company: "",
  gateName: "—",
  hostName: "—",
  siteName: "—",
  plate: "",
  reason: "",
  date: "—",
  minutes: 0,
  maxMinutes: 0,
  count: 0,
  escalated: "false",
};

function primitive(value: unknown): string | number | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

/** ICU arguments: payload primitives over the defaults, plus `hasX` selectors for optional fields. */
export function icuArgs(payload: NotificationPayload): Record<string, string | number> {
  const args: Record<string, string | number> = { ...ARG_DEFAULTS };
  for (const [key, value] of Object.entries(payload ?? {})) {
    const p = primitive(value);
    if (p !== null) args[key] = p;
  }
  const has = (key: string) => (typeof args[key] === "string" ? (args[key] as string).trim().length > 0 : args[key] !== 0);
  args.hasCompany = has("company") ? "yes" : "no";
  args.hasHost = has("hostName") && args.hostName !== "—" ? "yes" : "no";
  args.hasPlate = has("plate") ? "yes" : "no";
  args.hasReason = has("reason") ? "yes" : "no";
  return args;
}

/** Deep link for a notification when the caller did not pass one (relative to APP_URL). */
export function defaultUrl(type: NotificationType, payload: NotificationPayload): string {
  const passId = typeof payload?.passId === "string" ? payload.passId : null;
  switch (type) {
    case "pass_pending_approval":
      return "/app/approvals";
    case "pass_approved":
    case "pass_denied":
      return passId ? `/app/passes/${encodeURIComponent(passId)}` : "/app";
    case "evacuation_list":
      return "/guard/evacuation";
    default:
      return "/app/notifications";
  }
}

/**
 * Renders a notification in the reader's language from `notifications.types.<type>` (ICU, messages/*.json).
 * Pure: usable from React, route handlers, channels and tests. Never throws on a sparse payload.
 */
export function renderNotification(type: NotificationType, payload: NotificationPayload, locale: string): RenderedNotification {
  const loc: Locale = isLocale(locale) ? locale : defaultLocale;
  const t = createTranslator({
    locale: loc,
    messages: MESSAGES[loc],
    namespace: "notifications.types",
    onError: () => undefined,
    getMessageFallback: ({ key }) => key,
  });
  const args = icuArgs(payload);
  const title = t(`${type}.title`, args);
  const body = t(`${type}.body`, args);
  const url = typeof payload?.url === "string" && payload.url.startsWith("/") ? payload.url : defaultUrl(type, payload);
  return { title, body, url };
}
