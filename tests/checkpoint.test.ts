import { describe, expect, it } from "vitest";
import { checkpointDecision, readCheckpointAreaIds } from "@/lib/guard/checkpoint";
import { signStaticQr, validatePass } from "@/lib/passes/validate";
import { canEditFromLink, registrationPending } from "@/lib/passes/visitor";

const KEY = "k".repeat(32);
const base = { id: "p1", siteId: "s1", status: "active" as const, validFrom: new Date(Date.now() - 3_600_000), validUntil: new Date(Date.now() + 3_600_000), maxUses: 1, uses: 0, gateIds: [] };
const ctx = { siteId: "s1", gateId: "g1", key: KEY, timeZone: "America/Santo_Domingo" };

describe("checkpoint decision", () => {
  it("lets anyone inside pass when the checkpoint controls no area", () => {
    expect(checkpointDecision(["a1"], [])).toEqual({ allowed: true, matchedAreaIds: [] });
    expect(checkpointDecision([], [])).toEqual({ allowed: true, matchedAreaIds: [] });
  });
  it("requires one of the visit's areas to be controlled by the checkpoint", () => {
    expect(checkpointDecision(["a1", "a2"], ["a2", "a3"])).toEqual({ allowed: true, matchedAreaIds: ["a2"] });
    expect(checkpointDecision(["a1"], ["a2"])).toEqual({ allowed: false, matchedAreaIds: [] });
    expect(checkpointDecision([], ["a2"])).toEqual({ allowed: false, matchedAreaIds: [] });
  });
  it("reads the controlled areas from the gate settings, ignoring junk", () => {
    expect(readCheckpointAreaIds({ checkpointAreaIds: ["a", "b"], printer: { kind: "agent" } })).toEqual(["a", "b"]);
    expect(readCheckpointAreaIds({})).toEqual([]);
    expect(readCheckpointAreaIds(null)).toEqual([]);
    expect(readCheckpointAreaIds({ checkpointAreaIds: "nope" })).toEqual([]);
  });
});

describe("invitation links (self-registration)", () => {
  it("are pending until the visitor registers, then locked for edits but still open for the NDA", () => {
    const pending = { status: "active", validUntil: base.validUntil, selfRegistration: true, registeredAt: null };
    expect(registrationPending(pending)).toBe(true);
    expect(canEditFromLink(pending)).toBe(true);
    const done = { ...pending, registeredAt: new Date() };
    expect(registrationPending(done)).toBe(false);
    expect(canEditFromLink(done)).toBe(false);
    const classic = { status: "active", validUntil: base.validUntil, selfRegistration: false, registeredAt: null };
    expect(registrationPending(classic)).toBe(false);
    expect(canEditFromLink(classic)).toBe(true);
  });
  it("are refused at the kiosk until registered", () => {
    const payload = signStaticQr({ passId: "p1", exp: base.validUntil.getTime() / 1000, siteId: "s1" }, KEY);
    expect(validatePass(payload, { ...base, registrationPending: true }, ctx)).toEqual({ ok: false, reason: "not_registered" });
    expect(validatePass(payload, { ...base, registrationPending: false }, ctx).ok).toBe(true);
  });
});
