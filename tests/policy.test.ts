import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES, evaluatePolicy, missingDoc } from "@/lib/policies/evaluate";
import type { FormElement } from "@/lib/forms/schema";

describe("evaluatePolicy", () => {
  it("uses defaults when the site has no row", () => {
    const r = evaluatePolicy(null, { kind: "contractor", visitorDocHash: "h" });
    expect(r.initialStatus).toBe("pending_approval");
    expect(r.approverRole).toBe("security");
    expect(r.warnings).toContain("escort");
    expect(r.warnings).toContain("nda");
  });
  it("flags missing document and plate", () => {
    expect(evaluatePolicy(null, { kind: "visit" }).missing).toEqual(["doc"]);
    expect(evaluatePolicy(null, { kind: "carrier", visitorDocHash: "h" }).missing).toEqual(["plate"]);
    expect(evaluatePolicy(null, { kind: "delivery" }).missing).toEqual([]);
  });
  it("honours a site override", () => {
    const r = evaluatePolicy({ kind: "visit", ...DEFAULT_POLICIES.visit, requiresApproval: true, approverRole: "approver", allowedGateIds: ["g1"] }, { kind: "visit", visitorDocHash: "h", gateIds: ["g2"] });
    expect(r.initialStatus).toBe("pending_approval");
    expect(r.approverRole).toBe("approver");
    expect(r.missing).toEqual(["gate"]);
    expect(r.warnings).toContain("restricted_gates");
  });
  it("deliveries stay at reception without badge", () => {
    const r = evaluatePolicy(null, { kind: "delivery" });
    expect(r.badge).toBe(false);
    expect(r.warnings).toEqual(expect.arrayContaining(["reception_only", "no_badge"]));
    expect(r.maxDurationMin).toBe(30);
  });
});

describe("evaluatePolicy with a sign-in form", () => {
  const form: FormElement[] = [
    { id: "document", type: "document", mode: "required", showOn: ["host", "visitor", "kiosk"], onBadge: false },
    { id: "phone", type: "phone", mode: "required", showOn: ["visitor"], onBadge: false },
    { id: "plate", type: "plate", mode: "off", showOn: ["host"], onBadge: false },
    { id: "q1", type: "question", label: "Modelo", questionType: "select", options: ["A", "B"], required: true, showOn: ["host"], onBadge: false },
    { id: "ok", type: "question", label: "Acepto", questionType: "checkbox", options: [], required: true, showOn: ["visitor"], onBadge: false },
    { id: "sig", type: "signature", required: true, showOn: ["visitor"], onBadge: false },
  ];
  it("lists required built-ins and questions by element id for the surface", () => {
    expect(evaluatePolicy(null, { kind: "visit", form, surface: "host" }).missing).toEqual(["document", "q1"]);
    expect(evaluatePolicy(null, { kind: "visit", form, surface: "host", visitorDocHash: "h", answers: { q1: { label: "Modelo", value: "A" } } }).missing).toEqual([]);
    expect(evaluatePolicy(null, { kind: "visit", form, surface: "visitor", visitorDocHash: "h" }).missing).toEqual(["phone", "ok", "sig"]);
    expect(evaluatePolicy(null, { kind: "visit", form, surface: "visitor", visitorDocHash: "h", visitorPhone: "809", answers: { ok: { label: "Acepto", value: true } }, ndaAcceptedAt: new Date() }).missing).toEqual([]);
    expect(evaluatePolicy(null, { kind: "visit", form, surface: "kiosk" }).missing).toEqual(["document"]);
  });
  it("lets the form override the legacy carrier plate rule and keeps the gate rule", () => {
    expect(evaluatePolicy(null, { kind: "carrier", form, surface: "host", visitorDocHash: "h", answers: { q1: { label: "Modelo", value: "B" } } }).missing).toEqual([]);
    expect(evaluatePolicy({ kind: "visit", ...DEFAULT_POLICIES.visit, allowedGateIds: ["g1"] }, { kind: "visit", form, surface: "host", visitorDocHash: "h", gateIds: ["g2"], answers: { q1: { label: "Modelo", value: "B" } } }).missing).toEqual(["gate"]);
  });
  it("missingDoc recognises both the legacy id and the element id", () => {
    expect(missingDoc({ missing: ["doc"] })).toBe(true);
    expect(missingDoc({ missing: ["document"] }, form)).toBe(true);
    expect(missingDoc({ missing: ["q1"] }, form)).toBe(false);
  });
  it("keeps the legacy behaviour when no form is given", () => {
    expect(evaluatePolicy(null, { kind: "carrier" }).missing).toEqual(["doc", "plate"]);
  });
});

describe("missingFormFields per surface", () => {
  it("ignores required built-ins a surface cannot collect", async () => {
    const { missingFormFields } = await import("@/lib/policies/evaluate");
    const form: FormElement[] = [
      { id: "e", type: "email", mode: "required", showOn: ["host", "visitor", "kiosk"], onBadge: false },
      { id: "a", type: "areas", mode: "required", showOn: ["host", "visitor", "kiosk"], onBadge: false },
      { id: "d", type: "document", mode: "required", showOn: ["host", "visitor", "kiosk"], onBadge: false },
    ];
    // Kiosk walk-in has no e-mail or area pickers: only the document is enforced there.
    expect(missingFormFields(form, "kiosk", { kind: "vendor", form })).toEqual(["d"]);
    // The visitor link collects e-mail and document but cannot pick areas.
    expect(missingFormFields(form, "visitor", { kind: "vendor", form })).toEqual(["e", "d"]);
    // The host form enforces all three.
    expect(missingFormFields(form, "host", { kind: "vendor", form })).toEqual(["e", "a", "d"]);
  });
});
