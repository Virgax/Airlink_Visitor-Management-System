import { describe, expect, it } from "vitest";
import { isRotatingPass, qrPayloadFor } from "@/lib/passes/qr";
import { ROTATION_STEP_SEC, verifyQr } from "@/lib/passes/validate";

const key = "k".repeat(40);
const siteId = "site_a";
const now = new Date(Date.UTC(2026, 9, 26, 15, 0, 7));

describe("qrPayloadFor", () => {
  it("signs a static payload whose exp is validUntil", () => {
    const validUntil = new Date(now.getTime() + 3_600_000);
    const info = qrPayloadFor({ id: "p1", siteId, kind: "visit", schedule: null, validUntil }, now, key);
    expect(info.rotating).toBe(false);
    expect(info.refreshInSec).toBeNull();
    expect(info.expiresAt).toBe(Math.floor(validUntil.getTime() / 1000));
    expect(verifyQr(info.payload, { siteId, key, now: now.getTime() })).toMatchObject({ ok: true, qr: { kind: "static", passId: "p1", exp: info.expiresAt } });
    expect(verifyQr(info.payload, { siteId, key, now: validUntil.getTime() + 1000 })).toMatchObject({ ok: false, reason: "qr_expired" });
  });
  it("rotates for recurring passes and reports when the step ends", () => {
    const info = qrPayloadFor({ id: "p2", siteId, kind: "recurring", schedule: { days: [1], from: "08:00", to: "17:00" }, validUntil: new Date(now.getTime() + 86_400_000) }, now, key);
    expect(info.rotating).toBe(true);
    expect(info.refreshInSec).toBe(ROTATION_STEP_SEC - 7);
    expect(verifyQr(info.payload, { siteId, key, now: now.getTime() })).toMatchObject({ ok: true, qr: { kind: "rotating", passId: "p2" } });
    const later = qrPayloadFor({ id: "p2", siteId, kind: "recurring", schedule: null, validUntil: new Date(now.getTime() + 86_400_000) }, new Date(now.getTime() + 2 * ROTATION_STEP_SEC * 1000), key);
    expect(later.payload).not.toBe(info.payload);
    expect(verifyQr(info.payload, { siteId, key, now: now.getTime() + 3 * ROTATION_STEP_SEC * 1000 })).toMatchObject({ ok: false, reason: "qr_stale" });
  });
  it("treats any pass with a schedule as rotating", () => {
    expect(isRotatingPass({ kind: "contractor", schedule: { days: [1], from: "08:00", to: "17:00" } })).toBe(true);
    expect(isRotatingPass({ kind: "contractor", schedule: null })).toBe(false);
    expect(isRotatingPass({ kind: "recurring", schedule: null })).toBe(true);
  });
  it("never verifies for another site", () => {
    const info = qrPayloadFor({ id: "p1", siteId, kind: "visit", schedule: null, validUntil: new Date(now.getTime() + 3_600_000) }, now, key);
    expect(verifyQr(info.payload, { siteId: "site_b", key, now: now.getTime() })).toMatchObject({ ok: false, reason: "bad_signature" });
  });
});
