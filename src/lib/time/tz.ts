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

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. -240 for Santo Domingo). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const { ymd, minutes } = localParts(date, timeZone);
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** The instant for a wall-clock date and time ("YYYY-MM-DD", minutes since midnight) in `timeZone`. */
export function zonedToUtc(ymd: string, minutesOfDay: number, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + minutesOfDay * 60_000;
  if (Number.isNaN(guess)) return null;
  const first = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Second pass handles DST edges where the offset changes between the guess and the result.
  return new Date(guess - tzOffsetMinutes(new Date(first), timeZone) * 60_000);
}
