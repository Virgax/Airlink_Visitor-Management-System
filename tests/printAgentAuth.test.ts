import { describe, expect, it } from "vitest";
import { agentSignature, JOB_ID, printPrefix, verifyAgentRequest } from "@/lib/print/queue";

const secret = "s".repeat(32);
const now = Date.UTC(2026, 9, 28, 12, 0, 0);
const ts = String(Math.floor(now / 1000));
const path = "/api/print/jobs?gate=g1";

describe("print agent HMAC", () => {
  it("accepts a fresh, correctly signed request (with or without the sha256= prefix)", () => {
    const sig = agentSignature(secret, "GET", path, ts);
    expect(verifyAgentRequest({ secret, method: "get", pathWithQuery: path, timestamp: ts, signature: sig, now })).toEqual({ ok: true });
    expect(verifyAgentRequest({ secret, method: "GET", pathWithQuery: path, timestamp: ts, signature: `sha256=${sig.toUpperCase()}`, now })).toEqual({ ok: true });
  });
  it("rejects missing headers, old timestamps and other paths/methods", () => {
    const sig = agentSignature(secret, "GET", path, ts);
    expect(verifyAgentRequest({ secret, method: "GET", pathWithQuery: path, timestamp: null, signature: sig, now })).toEqual({ ok: false, reason: "missing" });
    expect(verifyAgentRequest({ secret, method: "GET", pathWithQuery: path, timestamp: ts, signature: sig, now: now + 10 * 60_000 })).toEqual({ ok: false, reason: "skew" });
    expect(verifyAgentRequest({ secret, method: "DELETE", pathWithQuery: path, timestamp: ts, signature: sig, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAgentRequest({ secret, method: "GET", pathWithQuery: "/api/print/jobs?gate=g2", timestamp: ts, signature: sig, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAgentRequest({ secret: "other".repeat(8), method: "GET", pathWithQuery: path, timestamp: ts, signature: sig, now })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("keeps jobs under the site/gate prefix and validates job ids", () => {
    expect(printPrefix("site1", "gate1")).toBe("s/site1/print/gate1/");
    expect(JOB_ID.test("1761652800000-cmh3visit0001")).toBe(true);
    expect(JOB_ID.test("../../etc")).toBe(false);
  });
});
