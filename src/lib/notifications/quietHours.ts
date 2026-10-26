import { localParts, parseHHmm } from "@/lib/time/tz";
import { URGENT_TYPES, type NotificationType } from "@/lib/notifications/types";

export const DEFAULT_TIMEZONE = "America/Santo_Domingo";

export type QuietWindow = { quietFrom: string | null; quietTo: string | null };

/**
 * True when `now` falls inside the quiet window expressed as "HH:mm" wall-clock times in `timeZone`.
 * Windows may wrap midnight (22:00 → 07:00). Start is inclusive, end exclusive. An empty, partial or
 * invalid window never silences anything; from == to is treated as "no window".
 */
export function isWithinQuietHours(now: Date, timeZone: string, window: QuietWindow): boolean {
  if (!window.quietFrom || !window.quietTo) return false;
  const from = parseHHmm(window.quietFrom);
  const to = parseHHmm(window.quietTo);
  if (from === null || to === null || from === to) return false;
  let minutes: number;
  try {
    minutes = localParts(now, timeZone).minutes;
  } catch {
    minutes = localParts(now, DEFAULT_TIMEZONE).minutes;
  }
  const end = to === 24 * 60 ? 0 : to;
  if (from < end) return minutes >= from && minutes < end;
  // wraps midnight (or ends at 24:00)
  return minutes >= from || minutes < end;
}

/** Channel delivery is suppressed during quiet hours unless the type is urgent. In-app rows are always stored. */
export function shouldDeliverNow(type: NotificationType, now: Date, timeZone: string, window: QuietWindow): boolean {
  if (URGENT_TYPES.has(type)) return true;
  return !isWithinQuietHours(now, timeZone, window);
}
