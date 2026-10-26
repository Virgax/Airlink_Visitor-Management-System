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

export const DEFAULT_TIME_ZONE = "America/Santo_Domingo";

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
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
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0, p.second ?? 0);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The UTC instant at which the local day `ymd` ("YYYY-MM-DD") starts in `timeZone`. */
export function zonedStartOfDay(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const localMidnight = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  let guess = localMidnight;
  for (let i = 0; i < 2; i++) guess = localMidnight - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Adds whole days to a "YYYY-MM-DD" string (calendar arithmetic, no time zone involved). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

/** Days between two "YYYY-MM-DD" strings (b - a). */
export function diffDaysYmd(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
