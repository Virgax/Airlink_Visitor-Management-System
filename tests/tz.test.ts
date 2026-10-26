import { describe, expect, it } from "vitest";
import { toLocalInput, tzOffsetMs, zonedToUtc } from "@/lib/time/tz";

const sd = "America/Santo_Domingo"; // UTC-4 all year

describe("zonedToUtc", () => {
  it("converts a datetime-local value in the site zone to an instant", () => {
    expect(zonedToUtc("2026-10-27T09:00", sd)?.toISOString()).toBe("2026-10-27T13:00:00.000Z");
    expect(zonedToUtc("2026-10-27T00:00", sd)?.toISOString()).toBe("2026-10-27T04:00:00.000Z");
  });
  it("handles zones with DST on both sides of a transition", () => {
    expect(zonedToUtc("2026-07-01T12:00", "Europe/Madrid")?.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedToUtc("2026-01-01T12:00", "Europe/Madrid")?.toISOString()).toBe("2026-01-01T11:00:00.000Z");
  });
  it("rejects malformed or impossible values", () => {
    expect(zonedToUtc("2026-02-31T10:00", sd)).toBeNull();
    expect(zonedToUtc("2026-10-27 10:00", sd)).toBeNull();
    expect(zonedToUtc("2026-10-27T24:00", sd)).toBeNull();
    expect(zonedToUtc("", sd)).toBeNull();
  });
  it("round-trips with toLocalInput", () => {
    const d = new Date("2026-10-27T13:05:00.000Z");
    expect(toLocalInput(d, sd)).toBe("2026-10-27T09:05");
    expect(zonedToUtc(toLocalInput(d, sd), sd)?.getTime()).toBe(d.getTime());
  });
  it("reports the zone offset", () => {
    expect(tzOffsetMs(new Date("2026-10-27T13:00:00Z"), sd)).toBe(-4 * 3_600_000);
    expect(tzOffsetMs(new Date("2026-07-01T10:00:00Z"), "Europe/Madrid")).toBe(2 * 3_600_000);
  });
});
