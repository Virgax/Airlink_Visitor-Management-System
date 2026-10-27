import { describe, expect, it } from "vitest";
import { signStaticQr, type PassForValidation } from "@/lib/passes/validate";
import { decideScan, entryStatus, matchBlacklist, passWarnings, policyFlags, validationInstant } from "@/lib/guard/decide";
import { parsePayloadShape, passIdFromPayload } from "@/lib/guard/payload";

const key = "k".repeat(40);
const siteId = "site_a";
const now = Date.UTC(2026, 9, 26, 15, 0, 0);

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

describe("payload shape (client-safe)", () => {
  it("reads the pass id without verifying", () => {
    expect(passIdFromPayload(payload)).toBe("p1");
    expect(parsePayloadShape(payload)).toMatchObject({ kind: "static", passId: "p1", exp: Math.floor(now / 1000 + 7200) });
    expect(parsePayloadShape("p1.rabc.sig")).toMatchObject({ kind: "rotating", passId: "p1" });
    expect(parsePayloadShape("nope")).toBeNull();
    expect(parsePayloadShape("a.b")).toBeNull();
    expect(parsePayloadShape("a b.c.d")).toBeNull();
  });
});

describe("decideScan", () => {
  it("enters on a valid pass", () => {
    expect(decideScan({ payload, pass: base, ctx, hasOpenVisit: false, offline: false })).toEqual({ action: "enter", conflict: false });
  });
  it("denies unknown passes and other sites before anything else", () => {
    expect(decideScan({ payload, pass: null, ctx, hasOpenVisit: false, offline: false })).toEqual({ action: "deny", reason: "not_found" });
    expect(decideScan({ payload, pass: { ...base, siteId: "site_b" }, ctx, hasOpenVisit: true, offline: false })).toEqual({ action: "deny", reason: "wrong_site" });
  });
  it("marks the exit on a second scan, even when the QR is past its exp", () => {
    expect(decideScan({ payload, pass: { ...base, uses: 1, status: "used" }, ctx, hasOpenVisit: true, offline: false })).toEqual({ action: "checkout" });
    const expired = signStaticQr({ passId: "p1", exp: now / 1000 - 10, siteId }, key);
    expect(decideScan({ payload: expired, pass: { ...base, uses: 1, status: "used" }, ctx, hasOpenVisit: true, offline: false })).toEqual({ action: "checkout" });
  });
  it("never checks out with a bad signature", () => {
    const forged = payload.slice(0, -2) + "zz";
    expect(decideScan({ payload: forged, pass: base, ctx, hasOpenVisit: true, offline: false })).toEqual({ action: "deny", reason: "bad_signature" });
    expect(decideScan({ payload: "garbage", pass: base, ctx, hasOpenVisit: true, offline: false })).toEqual({ action: "deny", reason: "malformed" });
  });
  it("denies no_uses_left online but records a conflict for queued offline scans", () => {
    const spent = { ...base, uses: 1 };
    expect(decideScan({ payload, pass: spent, ctx, hasOpenVisit: false, offline: false })).toEqual({ action: "deny", reason: "no_uses_left" });
    expect(decideScan({ payload, pass: spent, ctx, hasOpenVisit: false, offline: true })).toEqual({ action: "enter", conflict: true });
    expect(decideScan({ payload, pass: { ...base, status: "used", uses: 1 }, ctx, hasOpenVisit: false, offline: true })).toEqual({ action: "enter", conflict: true });
  });
  it("does not turn other denials into conflicts when offline", () => {
    expect(decideScan({ payload, pass: { ...base, status: "revoked" }, ctx, hasOpenVisit: false, offline: true })).toEqual({ action: "deny", reason: "revoked" });
    expect(decideScan({ payload, pass: base, ctx: { ...ctx, blacklisted: true }, hasOpenVisit: false, offline: true })).toEqual({ action: "deny", reason: "blacklisted" });
  });
  it("passes blacklist, company and policy through to validatePass", () => {
    expect(decideScan({ payload, pass: base, ctx: { ...ctx, companyBlocked: true }, hasOpenVisit: false, offline: false })).toEqual({ action: "deny", reason: "company_blocked" });
    expect(decideScan({ payload, pass: base, ctx: { ...ctx, policy: { requiresNda: true } }, hasOpenVisit: false, offline: false })).toEqual({ action: "deny", reason: "nda_required" });
    expect(decideScan({ payload, pass: base, ctx: { ...ctx, policy: { allowedGateIds: ["g2"] } }, hasOpenVisit: false, offline: false })).toEqual({ action: "deny", reason: "gate_not_allowed" });
  });
});

describe("blacklist matching", () => {
  const rows = [
    { id: "b1", siteId: null, docHash: "h1", plate: null, until: null },
    { id: "b2", siteId: "site_b", docHash: "h2", plate: null, until: null },
    { id: "b3", siteId: null, docHash: null, plate: "A123456", until: new Date(now - 1) },
    { id: "b4", siteId: siteId, docHash: null, plate: "B999999", until: new Date(now + 86_400_000) },
  ];
  it("matches global rows and rows of this site only, ignoring expired ones", () => {
    expect(matchBlacklist(rows, { docHash: "h1" }, siteId, new Date(now))?.id).toBe("b1");
    expect(matchBlacklist(rows, { docHash: "h2" }, siteId, new Date(now))).toBeNull();
    expect(matchBlacklist(rows, { plate: "A123456" }, siteId, new Date(now))).toBeNull();
    expect(matchBlacklist(rows, { plate: "B999999" }, siteId, new Date(now))?.id).toBe("b4");
    expect(matchBlacklist(rows, { docHash: null, plate: null }, siteId, new Date(now))).toBeNull();
  });
});

describe("warnings, status and timing helpers", () => {
  it("derives warnings from the policy and the areas", () => {
    expect(passWarnings(policyFlags("visit", null))).toEqual([]);
    expect(passWarnings(policyFlags("delivery", null))).toEqual(["receptionOnly", "noBadge"]);
    expect(passWarnings(policyFlags("contractor", null))).toEqual(["escort", "nda"]);
    expect(passWarnings(policyFlags("visit", { badge: false }), [{ escortRequired: true }])).toEqual(["escort", "noBadge"]);
  });
  it("sends carriers to the dock", () => {
    expect(entryStatus("carrier")).toBe("at_dock");
    expect(entryStatus("visit")).toBe("inside");
  });
  it("uses the client's instant only for plausible queued scans", () => {
    const n = new Date(now);
    expect(validationInstant(new Date(now - 60_000), true, n).getTime()).toBe(now - 60_000);
    expect(validationInstant(new Date(now - 60_000), false, n)).toBe(n);
    expect(validationInstant(new Date(now + 60_000), true, n)).toBe(n);
    expect(validationInstant(new Date(now - 2 * 86_400_000), true, n)).toBe(n);
    expect(validationInstant(new Date("x"), true, n)).toBe(n);
  });
});
