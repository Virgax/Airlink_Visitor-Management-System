import { describe, expect, it } from "vitest";
import { badgeSeq, formatBadgeNo, gateCode, gateInitial, siteCode } from "@/lib/badges/badgeNo";

describe("badge numbers", () => {
  it("builds the site code from the slug", () => {
    expect(siteCode("airlink-2")).toBe("A2");
    expect(siteCode("airlink-3")).toBe("A3");
    expect(siteCode("santiago")).toBe("SA");
    expect(siteCode("x")).toBe("XX");
    expect(siteCode("")).toBe("XX");
  });
  it("takes the gate initial without accents", () => {
    expect(gateInitial("Recepción")).toBe("R");
    expect(gateInitial("Muelle")).toBe("M");
    expect(gateInitial("Área 1")).toBe("A");
    expect(gateInitial("")).toBe("G");
  });
  it("formats and parses <code>-<NNNN>", () => {
    expect(gateCode("airlink-2", "Recepción")).toBe("A2R");
    expect(formatBadgeNo("A2R", 42)).toBe("A2R-0042");
    expect(formatBadgeNo("A2R", 12345)).toBe("A2R-12345");
    expect(badgeSeq("A2R-0042")).toBe(42);
    expect(badgeSeq("garbage")).toBeNull();
    expect(badgeSeq(null)).toBeNull();
  });
});
