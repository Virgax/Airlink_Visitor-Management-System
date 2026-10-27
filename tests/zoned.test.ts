import { describe, expect, it } from "vitest";
import { tzOffsetMinutes, zonedToUtc } from "@/lib/time/tz";

describe("zonedToUtc", () => {
  it("converts a Santo Domingo wall-clock time (UTC-4, no DST) to the right instant", () => {
    expect(zonedToUtc("2026-03-15", 23 * 60 + 59, "America/Santo_Domingo")?.toISOString()).toBe("2026-03-16T03:59:00.000Z");
    expect(tzOffsetMinutes(new Date("2026-03-15T12:00:00Z"), "America/Santo_Domingo")).toBe(-240);
  });
  it("handles DST zones and UTC", () => {
    expect(zonedToUtc("2026-07-01", 0, "Europe/Madrid")?.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(zonedToUtc("2026-01-01", 0, "Europe/Madrid")?.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(zonedToUtc("2026-01-01", 90, "UTC")?.toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });
  it("rejects malformed dates", () => {
    expect(zonedToUtc("2026-1-1", 0, "UTC")).toBeNull();
    expect(zonedToUtc("hoy", 0, "UTC")).toBeNull();
  });
});
