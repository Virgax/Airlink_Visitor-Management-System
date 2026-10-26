/** Local wall-clock parts of an instant in an IANA time zone (no library needed). */
export function localParts(date: Date, timeZone: string): { weekday: number; minutes: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = weekdays.indexOf(parts.weekday ?? "Sun");
  const hour = Number(parts.hour ?? 0) % 24;
  const minute = Number(parts.minute ?? 0);
  return { weekday, minutes: hour * 60 + minute, ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

export function parseHHmm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function fullParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of a zone at an instant: local wall clock minus UTC. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = fullParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Instant for a wall-clock value "YYYY-MM-DDTHH:mm" (what `<input type="datetime-local">` posts) in an IANA zone.
 * Returns null when the string is not a valid local date-time.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(naive).getUTCMonth() !== mo - 1) return null; // e.g. 31 February
  // Two passes handle DST transitions: the offset at the guessed instant may differ from the naive one.
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Wall-clock "YYYY-MM-DDTHH:mm" of an instant in a zone, for `<input type="datetime-local">` defaults. */
export function toLocalInput(date: Date, timeZone: string): string {
  const p = fullParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
