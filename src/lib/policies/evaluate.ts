import type { MembershipRole, VisitKind } from "@prisma/client";

export type PolicyInput = {
  kind: VisitKind;
  requiresApproval: boolean;
  approverRole: MembershipRole | null;
  requiresDoc: boolean;
  requiresNda: boolean;
  escortRequired: boolean;
  badge: boolean;
  allowedGateIds: string[];
  maxDurationMin: number | null;
  receptionOnly: boolean;
};

/** Sensible defaults per kind, used by the seed and when a site has no row for a kind. Data, editable in /admin. */
export const DEFAULT_POLICIES: Record<VisitKind, Omit<PolicyInput, "kind">> = {
  visit: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: true, allowedGateIds: [], maxDurationMin: null, receptionOnly: false },
  candidate: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: true, badge: true, allowedGateIds: [], maxDurationMin: 240, receptionOnly: false },
  contractor: { requiresApproval: true, approverRole: "security", requiresDoc: true, requiresNda: true, escortRequired: true, badge: true, allowedGateIds: [], maxDurationMin: null, receptionOnly: false },
  vendor: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: true, allowedGateIds: [], maxDurationMin: null, receptionOnly: false },
  auditor: { requiresApproval: true, approverRole: "approver", requiresDoc: true, requiresNda: true, escortRequired: true, badge: true, allowedGateIds: [], maxDurationMin: null, receptionOnly: false },
  carrier: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: false, allowedGateIds: [], maxDurationMin: 180, receptionOnly: false },
  delivery: { requiresApproval: false, approverRole: null, requiresDoc: false, requiresNda: false, escortRequired: false, badge: false, allowedGateIds: [], maxDurationMin: 30, receptionOnly: true },
  recurring: { requiresApproval: true, approverRole: "security", requiresDoc: true, requiresNda: true, escortRequired: false, badge: true, allowedGateIds: [], maxDurationMin: null, receptionOnly: false },
};

export type PassDraft = {
  kind: VisitKind;
  visitorDocHash?: string | null;
  plate?: string | null;
  gateIds?: string[];
  maxUses?: number;
};

export type PolicyEvaluation = {
  /** Initial status of a new pass */
  initialStatus: "active" | "pending_approval";
  approverRole: MembershipRole | null;
  /** Fields the host must fill before the pass is created */
  missing: Array<"doc" | "plate" | "gate">;
  /** Flags shown to security on the green screen */
  warnings: Array<"escort" | "reception_only" | "nda" | "no_badge" | "restricted_gates">;
  badge: boolean;
  maxDurationMin: number | null;
};

/** Evaluates a pass draft against its site policy. Pure, unit-tested. */
export function evaluatePolicy(policy: PolicyInput | null, draft: PassDraft): PolicyEvaluation {
  const p: PolicyInput = policy ?? { kind: draft.kind, ...DEFAULT_POLICIES[draft.kind] };
  const missing: PolicyEvaluation["missing"] = [];
  if (p.requiresDoc && !draft.visitorDocHash) missing.push("doc");
  if (draft.kind === "carrier" && !draft.plate) missing.push("plate");
  if (p.allowedGateIds.length > 0 && draft.gateIds && draft.gateIds.some((g) => !p.allowedGateIds.includes(g))) missing.push("gate");

  const warnings: PolicyEvaluation["warnings"] = [];
  if (p.escortRequired) warnings.push("escort");
  if (p.receptionOnly) warnings.push("reception_only");
  if (p.requiresNda) warnings.push("nda");
  if (!p.badge) warnings.push("no_badge");
  if (p.allowedGateIds.length > 0) warnings.push("restricted_gates");

  return {
    initialStatus: p.requiresApproval ? "pending_approval" : "active",
    approverRole: p.requiresApproval ? (p.approverRole ?? "security") : null,
    missing,
    warnings,
    badge: p.badge,
    maxDurationMin: p.maxDurationMin,
  };
}
