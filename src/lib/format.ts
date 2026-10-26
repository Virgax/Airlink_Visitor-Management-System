/** Date/number formatting with the UI locale and the site's time zone. Always use these, never toLocaleString ad hoc. */
export function fmtDate(
  date: Date | string | number,
  locale: string,
  opts: Intl.DateTimeFormatOptions & { timeZone?: string } = {},
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...opts }).format(d);
}

export function fmtNumber(value: number, locale: string, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale, opts).format(value);
}
