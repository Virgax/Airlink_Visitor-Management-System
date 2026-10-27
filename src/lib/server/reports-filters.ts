import { z } from "zod";
import type { ShiftLogKind, VisitKind, VisitStatus } from "@prisma/client";
import { addDaysYmd, diffDaysYmd, localParts, zonedStartOfDay } from "@/lib/time/tz";

/** Mirrors the Prisma enums (checked by `satisfies`) so the parser stays free of runtime Prisma imports. */
export const VISIT_KINDS = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"] as const satisfies readonly VisitKind[];
export const VISIT_STATUSES = ["pending", "approved", "denied", "inside", "at_dock", "left", "timeout"] as const satisfies readonly VisitStatus[];
export const SHIFT_LOG_KINDS = ["note", "incident", "round", "handover"] as const satisfies readonly ShiftLogKind[];

export const REPORT_PAGE_SIZE = 50;
export const SHIFT_LOG_TEXT_MAX = 2000;
/** Longest date range a report accepts (inclusive days). */
export const MAX_RANGE_DAYS = 366;

export type SearchParams = Record<string, string | string[] | undefined>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Empty strings and arrays collapse to undefined; invalid values fall back to undefined instead of failing. */
function text(max: number) {
  return z.preprocess((v) => {
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() !== "" ? s.trim().slice(0, max) : undefined;
  }, z.string().max(max).optional());
}
function ymd() {
  return z.preprocess((v) => (typeof v === "string" && YMD.test(v) ? v : undefined), z.string().optional());
}
function id() {
  return z.preprocess((v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined), z.string().optional());
}
function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((v) => (typeof v === "string" && (values as readonly string[]).includes(v) ? v : undefined), z.enum(values).optional());
}
const page = z.preprocess((v) => {
  const n = Number(typeof v === "string" ? v : "1");
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
}, z.number().int().min(1));

const baseSchema = z.object({
  from: ymd(),
  to: ymd(),
  siteId: id(),
  gateId: id(),
  page,
});

export const visitFiltersSchema = baseSchema.extend({
  kind: oneOf(VISIT_KINDS),
  status: oneOf(VISIT_STATUSES),
  host: text(80),
  areaId: id(),
  company: text(80),
});

export const shiftLogFiltersSchema = baseSchema.extend({
  kind: oneOf(SHIFT_LOG_KINDS),
  guard: text(80),
});

/** Dates are local calendar days ("YYYY-MM-DD") in the site's time zone; both ends inclusive. */
export type VisitFilters = Omit<z.infer<typeof visitFiltersSchema>, "from" | "to"> & { from: string; to: string };
export type ShiftLogFilters = Omit<z.infer<typeof shiftLogFiltersSchema>, "from" | "to"> & { from: string; to: string };

export type ParseOptions = { timeZone: string; now?: Date };

function normalizeRange<T extends { from?: string; to?: string }>(parsed: T, opts: ParseOptions): Omit<T, "from" | "to"> & { from: string; to: string } {
  const today = localParts(opts.now ?? new Date(), opts.timeZone).ymd;
  let from = parsed.from ?? parsed.to ?? today;
  let to = parsed.to ?? parsed.from ?? today;
  if (diffDaysYmd(from, to) < 0) [from, to] = [to, from];
  if (diffDaysYmd(from, to) > MAX_RANGE_DAYS - 1) to = addDaysYmd(from, MAX_RANGE_DAYS - 1);
  return { ...parsed, from, to };
}

/** Parses the visit-report search params. Never throws: bad values are dropped, dates default to today. */
export function parseVisitFilters(raw: SearchParams, opts: ParseOptions): VisitFilters {
  return normalizeRange(visitFiltersSchema.parse(raw), opts);
}

export function parseShiftLogFilters(raw: SearchParams, opts: ParseOptions): ShiftLogFilters {
  return normalizeRange(shiftLogFiltersSchema.parse(raw), opts);
}

/** UTC instants for the inclusive local range: `[start of from, start of the day after to)`. */
export function rangeToUtc(filters: { from: string; to: string }, timeZone: string): { from: Date; to: Date } {
  return { from: zonedStartOfDay(filters.from, timeZone), to: zonedStartOfDay(addDaysYmd(filters.to, 1), timeZone) };
}

/** Query string for links (export, pagination) that keeps every active filter. Page 1 is omitted. */
export function filtersToQuery(filters: Record<string, string | number | undefined>, overrides: Record<string, string | number | undefined> = {}): string {
  const merged = { ...filters, ...overrides };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && Number(v) <= 1)) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
