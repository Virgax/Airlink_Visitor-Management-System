import { describe, expect, it } from "vitest";
import { parseQr, ROTATION_STEP_SEC, signRotatingQr, signStaticQr, validatePass, verifyQr, type PassForValidation } from "@/lib/passes/validate";

const key = "k".repeat(40);
const siteId = "site_a";
const now = Date.UTC(2026, 9, 26, 15, 0, 0); // 2026-10-26 15:00Z = 11:00 Santo Domingo

describe("static QR", () => {
  it("signs and verifies", () => {
    const payload = signStaticQr({ passId: "p1", exp: now / 1000 + 3600, siteId }, key);
    expect(parseQr(payload)?.passId).toBe("p1");
    const res = verifyQr(payload, { siteId, key, now });
    expect(res).toMatchObject({ ok: true, qr: { kind: "static", passId: "p1" } });
  });
  it("rejects tampered payloads and other sites", () => {
    const payload = signStaticQr({ passId: "p1", exp: now / 1000 + 3600, siteId }, key);
    expect(verifyQr(payload.replace("p1", "p2"), { siteId, key, now })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyQr(payload, { siteId: "site_b", key, now })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyQr(payload, { siteId, key: "x".repeat(40), now })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyQr("garbage", { siteId, key, now })).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("expires", () => {
    const payload = signStaticQr({ passId: "p1", exp: now / 1000 - 1, siteId }, key);
    expect(verifyQr(payload, { siteId, key, now })).toMatchObject({ ok: false, reason: "qr_expired" });
  });
});

describe("rotating QR", () => {
  it("accepts the current and adjacent steps only", () => {
    const payload = signRotatingQr({ passId: "p1", siteId, now }, key);
    expect(verifyQr(payload, { siteId, key, now })).toMatchObject({ ok: true, qr: { kind: "rotating" } });
    expect(verifyQr(payload, { siteId, key, now: now + ROTATION_STEP_SEC * 1000 })).toMatchObject({ ok: true });
    expect(verifyQr(payload, { siteId, key, now: now + 3 * ROTATION_STEP_SEC * 1000 })).toMatchObject({ ok: false, reason: "qr_stale" });
  });
});

describe("validatePass", () => {
  const base: PassForValidation = {
    id: "p1",
    siteId,
    status: "active",
    validFrom: new Date(now - 3600_000),
    validUntil: new Date(now + 3600_000),
    maxUses: 1,
    uses: 0,
    gateIds: [],
    ndaAcceptedAt: null,
  };
  const ctx = { siteId, gateId: "g1", timeZone: "America/Santo_Domingo", key, now: new Date(now) };
  const payload = signStaticQr({ passId: "p1", exp: now / 1000 + 7200, siteId }, key);

  it("passes a valid pass", () => {
    expect(validatePass(payload, base, ctx)).toMatchObject({ ok: true });
  });
  it("blocks other sites even with a valid-looking QR", () => {
    expect(validatePass(payload, { ...base, siteId: "site_b" }, ctx)).toMatchObject({ ok: false, reason: "wrong_site" });
  });
  it("blocks blacklist and blocked companies before anything else", () => {
    expect(validatePass(payload, base, { ...ctx, blacklisted: true })).toMatchObject({ ok: false, reason: "blacklisted" });
    expect(validatePass(payload, base, { ...ctx, companyBlocked: true })).toMatchObject({ ok: false, reason: "company_blocked" });
  });
  it("respects status, uses and window", () => {
    expect(validatePass(payload, { ...base, status: "pending_approval" }, ctx)).toMatchObject({ ok: false, reason: "pending_approval" });
    expect(validatePass(payload, { ...base, status: "used" }, ctx)).toMatchObject({ ok: false, reason: "used" });
    expect(validatePass(payload, { ...base, uses: 1 }, ctx)).toMatchObject({ ok: false, reason: "no_uses_left" });
    expect(validatePass(payload, { ...base, validFrom: new Date(now + 60_000) }, ctx)).toMatchObject({ ok: false, reason: "not_yet_valid" });
    expect(validatePass(payload, { ...base, validUntil: new Date(now - 60_000) }, ctx)).toMatchObject({ ok: false, reason: "expired" });
  });
  it("checks gates from the pass or the policy", () => {
    expect(validatePass(payload, { ...base, gateIds: ["g2"] }, ctx)).toMatchObject({ ok: false, reason: "gate_not_allowed" });
    expect(validatePass(payload, base, { ...ctx, policy: { allowedGateIds: ["g2"] } })).toMatchObject({ ok: false, reason: "gate_not_allowed" });
    expect(validatePass(payload, { ...base, gateIds: ["g1"] }, { ...ctx, policy: { allowedGateIds: ["g2"] } })).toMatchObject({ ok: true });
  });
  it("requires NDA when the policy says so", () => {
    expect(validatePass(payload, base, { ...ctx, policy: { requiresNda: true } })).toMatchObject({ ok: false, reason: "nda_required" });
    expect(validatePass(payload, { ...base, ndaAcceptedAt: new Date(now) }, { ...ctx, policy: { requiresNda: true } })).toMatchObject({ ok: true });
  });
  it("returns not_found for missing passes", () => {
    expect(validatePass(payload, null, ctx)).toMatchObject({ ok: false, reason: "not_found" });
  });
});
