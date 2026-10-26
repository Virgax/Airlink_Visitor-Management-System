import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES, evaluatePolicy } from "@/lib/policies/evaluate";

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
