import type { MembershipRole, VisitKind } from "@prisma/client";
import { elementsFor, hasAnswer, isBuiltin, isRequired, type Answers, type BuiltinType, type FormElement, type FormSurface } from "@/lib/forms/schema";

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
  /** Phase 2: inline form JSON and template pointer (resolved by the caller into `PassDraft.form`). */
  form?: unknown;
  formTemplateId?: string | null;
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
  /** Resolved sign-in form (`resolveForm`). Without it the legacy rules apply (requiresDoc, carrier plate). */
  form?: FormElement[] | null;
  /** Which surface is being validated; defaults to the host invite form. */
  surface?: FormSurface;
  /** Custom answers given so far (`Pass.extra.answers`). */
  answers?: Answers | null;
  /** Built-in values beyond document and plate, checked against the form's required fields. */
  visitorName?: string | null;
  visitorPhone?: string | null;
  visitorEmail?: string | null;
  company?: string | null;
  areaIds?: string[];
  hostEmployeeId?: string | null;
  escortEmployeeId?: string | null;
  photoKey?: string | null;
  ndaAcceptedAt?: Date | string | null;
};

/** Legacy ids kept for callers that predate forms. With a form, built-ins are reported by their element id. */
export type MissingField = "doc" | "plate" | "gate" | (string & {});

export type PolicyEvaluation = {
  /** Initial status of a new pass */
  initialStatus: "active" | "pending_approval";
  approverRole: MembershipRole | null;
  /** Required fields (built-in and custom, by element id) still empty on this surface. */
  missing: MissingField[];
  /** Flags shown to security on the green screen */
  warnings: Array<"escort" | "reception_only" | "nda" | "no_badge" | "restricted_gates">;
  badge: boolean;
  maxDurationMin: number | null;
};

/** Evaluates a pass draft against its site policy. Pure, unit-tested. */
export function evaluatePolicy(policy: PolicyInput | null, draft: PassDraft): PolicyEvaluation {
  const p: PolicyInput = policy ?? { kind: draft.kind, ...DEFAULT_POLICIES[draft.kind] };
  const missing: PolicyEvaluation["missing"] = [];
  if (draft.form) {
    missing.push(...missingFormFields(draft.form, draft.surface ?? "host", draft));
  } else {
    if (p.requiresDoc && !draft.visitorDocHash) missing.push("doc");
    if (draft.kind === "carrier" && !draft.plate) missing.push("plate");
  }
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

/** Whether a built-in field has a value in the draft. */
function builtinFilled(type: BuiltinType, draft: PassDraft): boolean {
  switch (type) {
    case "document": return Boolean(draft.visitorDocHash);
    case "plate": return Boolean(draft.plate);
    case "name": return Boolean(draft.visitorName?.trim());
    case "phone": return Boolean(draft.visitorPhone?.trim());
    case "email": return Boolean(draft.visitorEmail?.trim());
    case "company": return Boolean(draft.company?.trim());
    case "areas": return (draft.areaIds?.length ?? 0) > 0;
    case "host": return Boolean(draft.hostEmployeeId);
    case "escort": return Boolean(draft.escortEmployeeId);
    case "photo": return Boolean(draft.photoKey);
  }
}

/** Ids of the required elements of one surface that the draft does not satisfy. */
export function missingFormFields(form: FormElement[], surface: FormSurface, draft: PassDraft): string[] {
  const answers = draft.answers ?? {};
  const out: string[] = [];
  for (const e of elementsFor(form, surface)) {
    if (!isRequired(e)) continue;
    if (isBuiltin(e)) {
      if (!builtinFilled(e.type, draft)) out.push(e.id);
    } else if (e.type === "question") {
      if (!hasAnswer(answers[e.id]?.value)) out.push(e.id);
    } else if (e.type === "signature") {
      if (!draft.ndaAcceptedAt) out.push(e.id);
    }
  }
  return out;
}

/** True when the document is among the missing fields (legacy "doc" or the built-in element id). */
export function missingDoc(evaluation: Pick<PolicyEvaluation, "missing">, form?: FormElement[] | null): boolean {
  const docId = form?.find((e) => isBuiltin(e) && e.type === "document")?.id ?? "document";
  return evaluation.missing.includes("doc") || evaluation.missing.includes(docId);
}
