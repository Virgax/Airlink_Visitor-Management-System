/**
 * Pure pass validation. No database access here: callers load the pass and context, this module decides.
 * QR payload: `passId.exp.sig` for static passes, `passId.r<step>.sig` for rotating (recurring) passes.
 * sig = HMAC-SHA256(PASS_SIGNING_KEY, `${passId}|${second}|${siteId}`) truncated to 16 bytes, base64url.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { localParts, parseHHmm } from "@/lib/time/tz";

export const ROTATION_STEP_SEC = 30;
const SIG_BYTES = 16;

export type Schedule = { days: number[]; from: string; to: string };

export type QrStatic = { kind: "static"; passId: string; exp: number };
export type QrRotating = { kind: "rotating"; passId: string; step: number };

function sig(key: string, passId: string, second: string, siteId: string): string {
  return createHmac("sha256", key).update(`${passId}|${second}|${siteId}`).digest().subarray(0, SIG_BYTES).toString("base64url");
}

function eq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Static QR: valid until `exp` (unix seconds). */
export function signStaticQr(input: { passId: string; exp: number; siteId: string }, key: string): string {
  const exp = Math.floor(input.exp).toString(36);
  return `${input.passId}.${exp}.${sig(key, input.passId, exp, input.siteId)}`;
}

/** Rotating QR for recurring passes; changes every ROTATION_STEP_SEC seconds. */
export function signRotatingQr(input: { passId: string; siteId: string; now?: number }, key: string): string {
  const step = Math.floor((input.now ?? Date.now()) / 1000 / ROTATION_STEP_SEC);
  const second = `r${step.toString(36)}`;
  return `${input.passId}.${second}.${sig(key, input.passId, second, input.siteId)}`;
}

export type ParsedQr = { passId: string; second: string; signature: string };

export function parseQr(payload: string): ParsedQr | null {
  const parts = payload.trim().split(".");
  if (parts.length !== 3) return null;
  const [passId, second, signature] = parts as [string, string, string];
  if (!passId || !second || !signature) return null;
  if (!/^[a-z0-9]+$/i.test(passId) || !/^r?[a-z0-9]+$/i.test(second)) return null;
  return { passId, second, signature };
}

export type QrVerifyResult =
  | { ok: true; qr: QrStatic | QrRotating }
  | { ok: false; reason: QrDenyReason };

/**
 * Verifies signature and freshness against a known siteId. The passId is readable before verification so the
 * caller can load the pass (and its siteId) first; a signature from another site never verifies.
 */
export function verifyQr(payload: string, ctx: { siteId: string; key: string; now?: number }): QrVerifyResult {
  const parsed = parseQr(payload);
  if (!parsed) return { ok: false, reason: "malformed" };
  const nowSec = Math.floor((ctx.now ?? Date.now()) / 1000);

  if (parsed.second.startsWith("r")) {
    const step = parseInt(parsed.second.slice(1), 36);
    if (!Number.isFinite(step)) return { ok: false, reason: "malformed" };
    if (!eq(parsed.signature, sig(ctx.key, parsed.passId, parsed.second, ctx.siteId))) return { ok: false, reason: "bad_signature" };
    const current = Math.floor(nowSec / ROTATION_STEP_SEC);
    if (Math.abs(current - step) > 1) return { ok: false, reason: "qr_stale" };
    return { ok: true, qr: { kind: "rotating", passId: parsed.passId, step } };
  }

  const exp = parseInt(parsed.second, 36);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (!eq(parsed.signature, sig(ctx.key, parsed.passId, parsed.second, ctx.siteId))) return { ok: false, reason: "bad_signature" };
  if (exp < nowSec) return { ok: false, reason: "qr_expired" };
  return { ok: true, qr: { kind: "static", passId: parsed.passId, exp } };
}

export function parseSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Schedule>;
  if (!Array.isArray(s.days) || typeof s.from !== "string" || typeof s.to !== "string") return null;
  const days = s.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  if (parseHHmm(s.from) === null || parseHHmm(s.to) === null) return null;
  return { days, from: s.from, to: s.to };
}

/**
 * Recurring schedule check in the site's time zone. A window crossing midnight (from > to) belongs to the day
 * it starts on: Mon 22:00–06:00 is valid on Tuesday 03:00 because the shift started Monday.
 */
export function isWithinSchedule(schedule: Schedule, at: Date, timeZone: string): boolean {
  const from = parseHHmm(schedule.from)!;
  const to = parseHHmm(schedule.to)!;
  const { weekday, minutes } = localParts(at, timeZone);
  if (from === to) return schedule.days.includes(weekday); // whole day
  if (from < to) return schedule.days.includes(weekday) && minutes >= from && minutes < to;
  // crosses midnight
  if (minutes >= from) return schedule.days.includes(weekday);
  if (minutes < to) return schedule.days.includes((weekday + 6) % 7);
  return false;
}

export type WindowResult = "ok" | "not_yet_valid" | "expired" | "outside_schedule";

export function checkWindow(
  pass: { validFrom: Date; validUntil: Date; schedule?: unknown },
  at: Date,
  timeZone: string,
): WindowResult {
  if (at < pass.validFrom) return "not_yet_valid";
  if (at >= pass.validUntil) return "expired";
  const schedule = parseSchedule(pass.schedule);
  if (schedule && !isWithinSchedule(schedule, at, timeZone)) return "outside_schedule";
  return "ok";
}

export type PassForValidation = {
  id: string;
  siteId: string;
  status: "pending_approval" | "active" | "used" | "revoked" | "expired" | "denied";
  validFrom: Date;
  validUntil: Date;
  maxUses: number;
  uses: number;
  schedule?: unknown;
  gateIds: string[];
  ndaAcceptedAt?: Date | null;
};

export type ValidationContext = {
  siteId: string;
  gateId: string;
  timeZone: string;
  key: string;
  now?: Date;
  blacklisted?: boolean;
  companyBlocked?: boolean;
  policy?: { requiresNda?: boolean; allowedGateIds?: string[] } | null;
};

export type QrDenyReason = "malformed" | "bad_signature" | "qr_expired" | "qr_stale";

export type DenyReason =
  | QrDenyReason
  | "wrong_site"
  | "pending_approval"
  | "revoked"
  | "denied"
  | "used"
  | "expired"
  | "not_yet_valid"
  | "outside_schedule"
  | "no_uses_left"
  | "gate_not_allowed"
  | "blacklisted"
  | "company_blocked"
  | "nda_required"
  | "not_found";

export type PassValidation = { ok: true; qr: QrStatic | QrRotating } | { ok: false; reason: DenyReason };

/** Full decision for a scan. Order matters: blacklist first (and it is audited by the caller), then the rest. */
export function validatePass(payload: string, pass: PassForValidation | null, ctx: ValidationContext): PassValidation {
  if (!pass) return { ok: false, reason: "not_found" };
  if (pass.siteId !== ctx.siteId) return { ok: false, reason: "wrong_site" };
  const now = ctx.now ?? new Date();

  const qr = verifyQr(payload, { siteId: pass.siteId, key: ctx.key, now: now.getTime() });
  if (!qr.ok) return { ok: false, reason: qr.reason };
  if (qr.qr.passId !== pass.id) return { ok: false, reason: "bad_signature" };

  if (ctx.blacklisted) return { ok: false, reason: "blacklisted" };
  if (ctx.companyBlocked) return { ok: false, reason: "company_blocked" };

  if (pass.status === "pending_approval") return { ok: false, reason: "pending_approval" };
  if (pass.status === "revoked") return { ok: false, reason: "revoked" };
  if (pass.status === "denied") return { ok: false, reason: "denied" };
  if (pass.status === "used") return { ok: false, reason: "used" };
  if (pass.status === "expired") return { ok: false, reason: "expired" };
  if (pass.uses >= pass.maxUses) return { ok: false, reason: "no_uses_left" };

  const window = checkWindow(pass, now, ctx.timeZone);
  if (window !== "ok") return { ok: false, reason: window };

  const allowedGates = pass.gateIds.length > 0 ? pass.gateIds : (ctx.policy?.allowedGateIds ?? []);
  if (allowedGates.length > 0 && !allowedGates.includes(ctx.gateId)) return { ok: false, reason: "gate_not_allowed" };

  if (ctx.policy?.requiresNda && !pass.ndaAcceptedAt) return { ok: false, reason: "nda_required" };

  return { ok: true, qr: qr.qr };
}
