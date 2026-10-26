/**
 * Pure helpers for the host's pass form: schedule building, group naming, bounds. No database access.
 */
import type { VisitKind } from "@prisma/client";
import { parseHHmm } from "@/lib/time/tz";
import type { Schedule } from "@/lib/passes/validate";

export const VISIT_KINDS: VisitKind[] = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"];
export const MAX_GROUP_SIZE = 50;
/** Recurring passes consume one use per entry; this is effectively "unlimited" within the validity range. */
export const RECURRING_MAX_USES = 10_000;

export function isVisitKind(value: unknown): value is VisitKind {
  return typeof value === "string" && (VISIT_KINDS as string[]).includes(value);
}

/**
 * Builds the `schedule` JSON from form values: `days` as posted by checkboxes ("0".."6", strings or numbers),
 * `from`/`to` as "HH:mm". Returns null when the input is incomplete or invalid.
 */
export function buildSchedule(input: { days: unknown; from: unknown; to: unknown }): Schedule | null {
  const rawDays = Array.isArray(input.days) ? input.days : input.days === undefined || input.days === null || input.days === "" ? [] : [input.days];
  const days = [...new Set(rawDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (days.length === 0) return null;
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (parseHHmm(from) === null || parseHHmm(to) === null) return null;
  const norm = (v: string) => {
    const [h, m] = v.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  };
  return { days, from: norm(from), to: norm(to) };
}

/** Clamps the requested group size to 1..MAX_GROUP_SIZE; anything unparsable is 1. */
export function parseGroupSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_GROUP_SIZE);
}

/**
 * Names for a group: the lead keeps the entered name, the rest get numbered placeholders
 * ("Visitante 2" … "Visitante N") that the host can rename later from the pass detail.
 */
export function groupVisitorNames(leadName: string, size: number, placeholder = "Visitante"): string[] {
  const n = parseGroupSize(size);
  const lead = leadName.trim();
  if (n === 1) return [lead];
  return Array.from({ length: n }, (_, i) => (i === 0 ? lead : `${placeholder} ${i + 1}`));
}

/** Validity window sanity: from < until and the pass does not span more than one year. */
export type WindowError = "window_order" | "window_too_long" | "window_past";

export function checkWindowRange(validFrom: Date, validUntil: Date, now: Date): WindowError | null {
  if (validUntil <= validFrom) return "window_order";
  if (validUntil.getTime() - validFrom.getTime() > 366 * 86_400_000) return "window_too_long";
  if (validUntil <= now) return "window_past";
  return null;
}

/** Splits a comma-separated multi-value into a trimmed, de-duplicated list of ids. */
export function uniqueIds(values: unknown): string[] {
  const arr = Array.isArray(values) ? values : values === undefined || values === null || values === "" ? [] : [values];
  return [...new Set(arr.map((v) => String(v).trim()).filter((v) => /^[A-Za-z0-9_-]{1,64}$/.test(v)))];
}
