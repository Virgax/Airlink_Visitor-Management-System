import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generatePin, isEmployeePin, isPassPin, isWeakPin, matchPin, MAX_PIN_CANDIDATES, normalizePin, pinCandidates, type PinCandidate } from "@/lib/people/pin";

const now = new Date(Date.UTC(2026, 9, 28, 14, 0, 0)); // Wed 10:00 in Santo Domingo
const tz = "America/Santo_Domingo";

function row(over: Partial<PinCandidate> = {}): PinCandidate {
  return {
    passId: "p1",
    pinHash: "hash-p1",
    siteId: "site_a",
    status: "active",
    validFrom: new Date(now.getTime() - 3_600_000),
    validUntil: new Date(now.getTime() + 3_600_000),
    visitorName: "Ana Pérez",
    source: "pass",
    ...over,
  };
}

describe("PIN generation and validation", () => {
  it("generates numeric PINs of the requested length, keeping leading zeros", () => {
    for (let i = 0; i < 50; i++) expect(generatePin()).toMatch(/^\d{6}$/);
    expect(generatePin(4)).toMatch(/^\d{4}$/);
    const seen = new Set(Array.from({ length: 30 }, () => generatePin()));
    expect(seen.size).toBeGreaterThan(5);
  });
  it("normalizes typed input to digits", () => {
    expect(normalizePin(" 12-34 56 ")).toBe("123456");
    expect(normalizePin("1234567890")).toBe("12345678");
    expect(normalizePin(null)).toBe("");
  });
  it("accepts 6-digit pass PINs and 4–8 digit employee PINs", () => {
    expect(isPassPin("123456")).toBe(true);
    expect(isPassPin("12345")).toBe(false);
    expect(isEmployeePin("1234")).toBe(true);
    expect(isEmployeePin("12345678")).toBe(true);
    expect(isEmployeePin("123")).toBe(false);
    expect(isEmployeePin("123456789")).toBe(false);
    expect(isEmployeePin("12a4")).toBe(false);
  });
  it("flags weak PINs", () => {
    expect(isWeakPin("1111")).toBe(true);
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("987654")).toBe(true);
    expect(isWeakPin("2468")).toBe(false);
  });
  it("round-trips through scrypt", async () => {
    const pin = generatePin();
    const hash = await hashPassword(pin);
    expect(await verifyPassword(pin, hash)).toBe(true);
    expect(await verifyPassword(pin === "000000" ? "000001" : "000000", hash)).toBe(false);
  });
});

describe("pinCandidates", () => {
  const ctx = { siteId: "site_a", timeZone: tz, now };
  it("keeps only active passes of the site valid now", () => {
    const rows = [
      row(),
      row({ passId: "other-site", siteId: "site_b" }),
      row({ passId: "pending", status: "pending_approval" }),
      row({ passId: "expired", validUntil: new Date(now.getTime() - 60_000) }),
      row({ passId: "future", validFrom: new Date(now.getTime() + 60_000) }),
      row({ passId: "no-pin", pinHash: "" }),
    ];
    expect(pinCandidates(rows, ctx).map((r) => r.passId)).toEqual(["p1"]);
  });
  it("applies the recurring schedule at the kiosk's local time", () => {
    const weekdays = row({ passId: "rec", schedule: { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00" } });
    const night = row({ passId: "night", schedule: { days: [1, 2, 3, 4, 5], from: "22:00", to: "06:00" } });
    const weekend = row({ passId: "weekend", schedule: { days: [0, 6], from: "08:00", to: "17:00" } });
    expect(pinCandidates([weekdays, night, weekend], ctx).map((r) => r.passId)).toEqual(["rec"]);
  });
  it("narrows by the name fragment typed at the kiosk (case-insensitive)", () => {
    const rows = [row(), row({ passId: "p2", visitorName: "Luis Gómez" })];
    expect(pinCandidates(rows, { ...ctx, name: "gómez" }).map((r) => r.passId)).toEqual(["p2"]);
    expect(pinCandidates(rows, { ...ctx, name: "  " }).map((r) => r.passId)).toEqual(["p1", "p2"]);
  });
  it("prefers the pass's own hash over the frequent visitor's for the same pass", () => {
    const rows = [row({ pinHash: "hash-frequent", source: "frequent" }), row({ pinHash: "hash-pass", source: "pass" })];
    const out = pinCandidates(rows, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.pinHash).toBe("hash-pass");
    const only = pinCandidates([row({ pinHash: "hash-frequent", source: "frequent" })], ctx);
    expect(only[0]!.source).toBe("frequent");
  });
  it("caps the list so a PIN entry never runs unbounded scrypt comparisons", () => {
    const rows = Array.from({ length: MAX_PIN_CANDIDATES + 20 }, (_, i) => row({ passId: `p${i}` }));
    expect(pinCandidates(rows, ctx)).toHaveLength(MAX_PIN_CANDIDATES);
  });
});

describe("matchPin", () => {
  it("returns the first candidate whose hash verifies and null otherwise", async () => {
    const hashA = await hashPassword("111222");
    const hashB = await hashPassword("333444");
    const candidates = [
      { passId: "a", pinHash: hashA },
      { passId: "b", pinHash: hashB },
    ];
    expect((await matchPin("333444", candidates, verifyPassword))?.passId).toBe("b");
    expect(await matchPin("999999", candidates, verifyPassword)).toBeNull();
    expect(await matchPin("111222", [], verifyPassword)).toBeNull();
  });
});
