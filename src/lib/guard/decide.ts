/**
 * Pure decision logic for the kiosk scan. No database access: the route loads the pass, the policy, the blacklist
 * rows and the open visit, and this module decides what to do. Unit-tested in tests/guard-decide.test.ts.
 */
import type { VisitKind, VisitStatus } from "@prisma/client";
import { DEFAULT_POLICIES } from "@/lib/policies/evaluate";
import { validatePass, verifyQr, type DenyReason, type PassForValidation, type ValidationContext } from "@/lib/passes/validate";
import type { PassWarning } from "@/lib/guard/types";

export type { PassWarning };

export type PolicyFlags = { requiresNda: boolean; escortRequired: boolean; badge: boolean; receptionOnly: boolean; allowedGateIds: string[]; autoPrintBadge: boolean };

/** The policy row for a kind, or the seed defaults when the site has none. */
export function policyFlags(kind: VisitKind, policy: Partial<PolicyFlags> | null | undefined): PolicyFlags {
  const d = DEFAULT_POLICIES[kind];
  return {
    requiresNda: policy?.requiresNda ?? d.requiresNda,
    escortRequired: policy?.escortRequired ?? d.escortRequired,
    badge: policy?.badge ?? d.badge,
    receptionOnly: policy?.receptionOnly ?? d.receptionOnly,
    allowedGateIds: policy?.allowedGateIds ?? d.allowedGateIds,
    autoPrintBadge: policy?.autoPrintBadge ?? false,
  };
}

/** Flags shown on the green screen: escort (policy or any visited area), NDA, reception only, no badge. */
export function passWarnings(policy: PolicyFlags, areas: Array<{ escortRequired?: boolean; restricted?: boolean }> = []): PassWarning[] {
  const out: PassWarning[] = [];
  if (policy.escortRequired || areas.some((a) => a.escortRequired || a.restricted)) out.push("escort");
  if (policy.requiresNda) out.push("nda");
  if (policy.receptionOnly) out.push("receptionOnly");
  if (!policy.badge) out.push("noBadge");
  return out;
}

export type BlacklistRow = { id: string; siteId: string | null; docHash: string | null; plate: string | null; until: Date | null };

/** First blacklist row that applies to this visitor at this site (global rows apply everywhere; `until` in the past is ignored). */
export function matchBlacklist(
  rows: BlacklistRow[],
  visitor: { docHash?: string | null; plate?: string | null },
  siteId: string,
  now = new Date(),
): BlacklistRow | null {
  for (const row of rows) {
    if (row.siteId !== null && row.siteId !== siteId) continue;
    if (row.until && row.until <= now) continue;
    if (visitor.docHash && row.docHash && row.docHash === visitor.docHash) return row;
    if (visitor.plate && row.plate && row.plate === visitor.plate) return row;
  }
  return null;
}

/** Status a visit gets when the visitor enters: carriers wait at the dock, everybody else is inside. */
export function entryStatus(kind: VisitKind): Extract<VisitStatus, "inside" | "at_dock"> {
  return kind === "carrier" ? "at_dock" : "inside";
}

export type ScanDecision =
  | { action: "deny"; reason: DenyReason }
  | { action: "enter"; conflict: boolean }
  | { action: "checkout" };

export type ScanInput = {
  payload: string;
  pass: PassForValidation | null;
  ctx: ValidationContext;
  /** An open visit (inside/at_dock) already exists for this pass at this site: the second scan marks the exit. */
  hasOpenVisit: boolean;
  /** The kiosk validated offline and queued the scan; a pass consumed meanwhile is recorded as a conflict, not denied. */
  offline: boolean;
};

/**
 * Decides a scan. Order: wrong site → signature → open visit (checkout) → full validation (blacklist first, then
 * status, uses, window, gate, NDA). For a checkout the QR only needs a valid signature (it may be past `exp`).
 */
export function decideScan(input: ScanInput): ScanDecision {
  const { payload, pass, ctx } = input;
  if (!pass) return { action: "deny", reason: "not_found" };
  if (pass.siteId !== ctx.siteId) return { action: "deny", reason: "wrong_site" };

  if (input.hasOpenVisit) {
    const qr = verifyQr(payload, { siteId: pass.siteId, key: ctx.key, now: (ctx.now ?? new Date()).getTime() });
    if (!qr.ok && (qr.reason === "malformed" || qr.reason === "bad_signature")) return { action: "deny", reason: qr.reason };
    if (qr.ok && qr.qr.passId !== pass.id) return { action: "deny", reason: "bad_signature" };
    return { action: "checkout" };
  }

  const res = validatePass(payload, pass, ctx);
  if (res.ok) return { action: "enter", conflict: false };
  if (input.offline && (res.reason === "no_uses_left" || res.reason === "used")) return { action: "enter", conflict: true };
  return { action: "deny", reason: res.reason };
}

/** Instant used to validate a queued scan: the client's `at` when plausible (last 24 h, not in the future). */
export function validationInstant(at: Date | null | undefined, offline: boolean, now = new Date()): Date {
  if (!offline || !at || Number.isNaN(at.getTime())) return now;
  if (at.getTime() > now.getTime()) return now;
  if (now.getTime() - at.getTime() > 24 * 3_600_000) return now;
  return at;
}
