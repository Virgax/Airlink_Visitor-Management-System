/**
 * Auto sign-out instant for a visit (pure, unit-tested). A policy's `autoSignOutAt` ("HH:mm", site time zone)
 * closes every open visit of that kind at that wall-clock time: a visit that entered before today's cutoff closes at
 * today's cutoff; one that entered after it (e.g. a night shift) closes at tomorrow's. The cron job compares the
 * result with `now` and uses it as `leftAt`, so the job is idempotent and independent of how often it runs.
 */
import { addDaysYmd, localParts, zonedToUtc } from "@/lib/time/tz";

export const AUTO_SIGN_OUT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Normalizes user input ("8:5", "08:05", " 23:59 ") to "HH:mm"; null when it is not a valid time of day. */
export function normalizeAutoSignOutAt(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** The cutoff instant that applies to a visit entered at `enteredAt`: the first `autoSignOutAt` at or after it. */
export function autoCloseInstant(enteredAt: Date, autoSignOutAt: string, timeZone: string): Date | null {
  const hhmm = normalizeAutoSignOutAt(autoSignOutAt);
  if (!hhmm) return null;
  const day = localParts(enteredAt, timeZone).ymd;
  const sameDay = zonedToUtc(`${day}T${hhmm}`, timeZone);
  if (!sameDay) return null;
  if (sameDay.getTime() > enteredAt.getTime()) return sameDay;
  return zonedToUtc(`${addDaysYmd(day, 1)}T${hhmm}`, timeZone);
}

/** Whether `now` has reached the visit's cutoff; returns the cutoff (to use as `leftAt`) or null while still open. */
export function autoCloseDue(enteredAt: Date, autoSignOutAt: string, timeZone: string, now: Date): Date | null {
  const cutoff = autoCloseInstant(enteredAt, autoSignOutAt, timeZone);
  if (!cutoff || cutoff.getTime() > now.getTime()) return null;
  return cutoff;
}

/** Parses a comma/semicolon/newline separated list of e-mail addresses; null when any entry is invalid. */
export function parseEmailList(raw: string, max = 20): string[] | null {
  const parts = raw.split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length > max) return null;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return unique.every((e) => e.length <= 254 && re.test(e)) ? unique : null;
}
