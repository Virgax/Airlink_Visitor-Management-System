import { describe, expect, it } from "vitest";
import { isWithinQuietHours, shouldDeliverNow } from "@/lib/notifications/quietHours";

const TZ = "America/Santo_Domingo"; // UTC-4, no DST

/** Builds an instant whose Santo Domingo wall clock is HH:mm on 2026-10-26. */
function at(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 26, (h ?? 0) + 4, m ?? 0));
}

describe("isWithinQuietHours", () => {
  it("is never quiet without a complete window", () => {
    expect(isWithinQuietHours(at("23:00"), TZ, { quietFrom: null, quietTo: null })).toBe(false);
    expect(isWithinQuietHours(at("23:00"), TZ, { quietFrom: "22:00", quietTo: null })).toBe(false);
    expect(isWithinQuietHours(at("23:00"), TZ, { quietFrom: "bad", quietTo: "07:00" })).toBe(false);
    expect(isWithinQuietHours(at("23:00"), TZ, { quietFrom: "22:00", quietTo: "22:00" })).toBe(false);
  });

  it("handles a same-day window (start inclusive, end exclusive)", () => {
    const w = { quietFrom: "12:00", quietTo: "14:00" };
    expect(isWithinQuietHours(at("11:59"), TZ, w)).toBe(false);
    expect(isWithinQuietHours(at("12:00"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("13:30"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("14:00"), TZ, w)).toBe(false);
  });

  it("wraps midnight", () => {
    const w = { quietFrom: "22:00", quietTo: "07:00" };
    expect(isWithinQuietHours(at("21:59"), TZ, w)).toBe(false);
    expect(isWithinQuietHours(at("22:00"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("23:59"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("00:00"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("06:59"), TZ, w)).toBe(true);
    expect(isWithinQuietHours(at("07:00"), TZ, w)).toBe(false);
    expect(isWithinQuietHours(at("12:00"), TZ, w)).toBe(false);
  });

  it("evaluates in the given time zone, not UTC", () => {
    // 02:00 UTC is 22:00 in Santo Domingo.
    const instant = new Date(Date.UTC(2026, 9, 27, 2, 0));
    const w = { quietFrom: "22:00", quietTo: "23:00" };
    expect(isWithinQuietHours(instant, TZ, w)).toBe(true);
    expect(isWithinQuietHours(instant, "UTC", w)).toBe(false);
    expect(isWithinQuietHours(instant, "Europe/Madrid", w)).toBe(false);
  });

  it("accepts 24:00 as an end and falls back for invalid zones", () => {
    expect(isWithinQuietHours(at("23:59"), TZ, { quietFrom: "00:00", quietTo: "24:00" })).toBe(true);
    expect(isWithinQuietHours(at("23:00"), "Not/AZone", { quietFrom: "22:00", quietTo: "07:00" })).toBe(true);
  });
});

describe("shouldDeliverNow", () => {
  const quiet = { quietFrom: "22:00", quietTo: "07:00" };
  it("suppresses non-urgent types during quiet hours", () => {
    expect(shouldDeliverNow("visit_entered", at("23:00"), TZ, quiet)).toBe(false);
    expect(shouldDeliverNow("pass_approved", at("03:00"), TZ, quiet)).toBe(false);
    expect(shouldDeliverNow("visit_entered", at("10:00"), TZ, quiet)).toBe(true);
  });
  it("always delivers urgent types", () => {
    expect(shouldDeliverNow("visit_at_gate", at("23:00"), TZ, quiet)).toBe(true);
    expect(shouldDeliverNow("blacklist_hit", at("03:00"), TZ, quiet)).toBe(true);
    expect(shouldDeliverNow("carrier_at_dock", at("03:00"), TZ, quiet)).toBe(true);
  });
});
