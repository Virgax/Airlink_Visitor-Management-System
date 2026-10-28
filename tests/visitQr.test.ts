import { describe, expect, it } from "vitest";
import { parseVisitQr, signVisitQr, verifyVisitQr } from "@/lib/badges/visitQr";
import { parsePayloadShape } from "@/lib/guard/payload";
import { signStaticQr } from "@/lib/passes/validate";

const key = "k".repeat(40);

describe("visit QR (badge)", () => {
  it("signs `visitId.sig` and verifies it for the same site", () => {
    const payload = signVisitQr({ visitId: "cmh3visit0001", siteId: "site_a" }, key);
    expect(payload.split(".")).toHaveLength(2);
    expect(parseVisitQr(payload)?.visitId).toBe("cmh3visit0001");
    expect(verifyVisitQr(payload, { siteId: "site_a", key })).toEqual({ ok: true, visitId: "cmh3visit0001" });
  });
  it("rejects other sites, other keys and tampering", () => {
    const payload = signVisitQr({ visitId: "cmh3visit0001", siteId: "site_a" }, key);
    expect(verifyVisitQr(payload, { siteId: "site_b", key })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyVisitQr(payload, { siteId: "site_a", key: "x".repeat(40) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyVisitQr(payload.replace("0001", "0002"), { siteId: "site_a", key })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyVisitQr("garbage", { siteId: "site_a", key })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyVisitQr("a.b.c", { siteId: "site_a", key })).toEqual({ ok: false, reason: "malformed" });
  });
  it("never parses as a pass payload and pass payloads never parse as a badge", () => {
    const badge = signVisitQr({ visitId: "cmh3visit0001", siteId: "site_a" }, key);
    const pass = signStaticQr({ passId: "cmh3pass0001", exp: 1_900_000_000, siteId: "site_a" }, key);
    expect(parsePayloadShape(badge)).toBeNull();
    expect(parseVisitQr(pass)).toBeNull();
  });
});
