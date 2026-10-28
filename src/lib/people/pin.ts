/**
 * Pure PIN helpers shared by the people screen (employee PIN), passes (6-digit visitor PIN) and the kiosk PIN
 * entry. Hashing is scrypt through `src/lib/auth/password.ts`; nothing here touches the database.
 */
import { randomInt } from "node:crypto";
import { checkWindow } from "@/lib/passes/validate";

/** Visitor PINs (passes, frequent visitors) are always 6 digits. */
export const PASS_PIN_LENGTH = 6;
/** Employee / kiosk staff PINs: 4 to 8 digits. */
export const EMPLOYEE_PIN_MIN = 4;
export const EMPLOYEE_PIN_MAX = 8;

/** Random numeric PIN (crypto RNG). Leading zeros are kept, so the result always has `length` digits. */
export function generatePin(length = PASS_PIN_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

/** Keeps digits only (visitors may type spaces or dashes); never more than 8 characters. */
export function normalizePin(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\D/g, "").slice(0, EMPLOYEE_PIN_MAX) : "";
}

export function isPassPin(pin: string): boolean {
  return new RegExp(`^\\d{${PASS_PIN_LENGTH}}$`).test(pin);
}

export function isEmployeePin(pin: string): boolean {
  return new RegExp(`^\\d{${EMPLOYEE_PIN_MIN},${EMPLOYEE_PIN_MAX}}$`).test(pin);
}

/** Rejects trivially guessable PINs (all the same digit, straight sequences) for employee PINs. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const asc = "0123456789";
  const desc = "9876543210";
  return asc.includes(pin) || desc.includes(pin);
}

export type PinCandidate = {
  passId: string;
  pinHash: string;
  siteId: string;
  status: string;
  validFrom: Date;
  validUntil: Date;
  schedule?: unknown;
  visitorName: string;
  /** Where the hash came from: the pass itself or a frequent visitor linked to it. */
  source: "pass" | "frequent";
};

/** Hard cap on scrypt comparisons per PIN entry: beyond this the kiosk must narrow with the visitor's name. */
export const MAX_PIN_CANDIDATES = 50;

/**
 * Narrows the passes a typed PIN may belong to before any scrypt comparison: same site, active, inside the validity
 * window and (for recurring passes) the schedule at `now`, optionally matching a name fragment typed by the guard.
 * One candidate per pass: a pass's own hash wins over the frequent visitor's. Result is capped at MAX_PIN_CANDIDATES.
 */
export function pinCandidates(rows: PinCandidate[], ctx: { siteId: string; timeZone: string; now: Date; name?: string | null }): PinCandidate[] {
  const name = (ctx.name ?? "").trim().toLowerCase();
  const byPass = new Map<string, PinCandidate>();
  for (const row of rows) {
    if (row.siteId !== ctx.siteId || row.status !== "active" || !row.pinHash) continue;
    if (checkWindow(row, ctx.now, ctx.timeZone) !== "ok") continue;
    if (name && !row.visitorName.toLowerCase().includes(name)) continue;
    const existing = byPass.get(row.passId);
    if (!existing || (existing.source === "frequent" && row.source === "pass")) byPass.set(row.passId, row);
  }
  return [...byPass.values()].slice(0, MAX_PIN_CANDIDATES);
}

/** Finds the first candidate whose hash verifies; `verify` is the scrypt compare (injected so the module stays pure). */
export async function matchPin<T extends { pinHash: string }>(pin: string, candidates: T[], verify: (pin: string, hash: string) => Promise<boolean>): Promise<T | null> {
  for (const c of candidates) {
    if (await verify(pin, c.pinHash)) return c;
  }
  return null;
}
