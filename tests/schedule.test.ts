import { describe, expect, it } from "vitest";
import { checkWindow, isWithinSchedule, parseSchedule } from "@/lib/passes/validate";
import { localParts } from "@/lib/time/tz";

const tz = "America/Santo_Domingo"; // UTC-4, no DST

function sd(y: number, m: number, d: number, h: number, min = 0): Date {
  // local Santo Domingo wall clock → instant
  return new Date(Date.UTC(y, m - 1, d, h + 4, min));
}

describe("localParts", () => {
  it("converts to the site's wall clock", () => {
    const p = localParts(sd(2026, 10, 26, 9, 30), tz); // Monday
    expect(p).toMatchObject({ weekday: 1, minutes: 9 * 60 + 30, ymd: "2026-10-26" });
  });
  it("handles midnight as 00:00, not 24:00", () => {
    expect(localParts(sd(2026, 10, 27, 0, 0), tz).minutes).toBe(0);
  });
});

describe("isWithinSchedule", () => {
  const weekdays = { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00" };
  it("accepts inside the window on allowed days", () => {
    expect(isWithinSchedule(weekdays, sd(2026, 10, 26, 8, 0), tz)).toBe(true);
    expect(isWithinSchedule(weekdays, sd(2026, 10, 26, 16, 59), tz)).toBe(true);
  });
  it("rejects outside hours or days", () => {
    expect(isWithinSchedule(weekdays, sd(2026, 10, 26, 17, 0), tz)).toBe(false);
    expect(isWithinSchedule(weekdays, sd(2026, 10, 25, 10, 0), tz)).toBe(false); // Sunday
  });
  it("evaluates in the site time zone, not UTC", () => {
    // 20:30 UTC on Monday is 16:30 in Santo Domingo → inside
    expect(isWithinSchedule(weekdays, new Date(Date.UTC(2026, 9, 26, 20, 30)), tz)).toBe(true);
    // 21:30 UTC is 17:30 local → outside
    expect(isWithinSchedule(weekdays, new Date(Date.UTC(2026, 9, 26, 21, 30)), tz)).toBe(false);
  });
  it("handles windows crossing midnight on the day the shift starts", () => {
    const night = { days: [1], from: "22:00", to: "06:00" }; // Monday night shift
    expect(isWithinSchedule(night, sd(2026, 10, 26, 23, 0), tz)).toBe(true); // Mon 23:00
    expect(isWithinSchedule(night, sd(2026, 10, 27, 3, 0), tz)).toBe(true); // Tue 03:00 (started Monday)
    expect(isWithinSchedule(night, sd(2026, 10, 27, 6, 0), tz)).toBe(false); // Tue 06:00
    expect(isWithinSchedule(night, sd(2026, 10, 26, 3, 0), tz)).toBe(false); // Mon 03:00 (Sunday shift, not allowed)
    expect(isWithinSchedule(night, sd(2026, 10, 27, 23, 0), tz)).toBe(false); // Tue 23:00
  });
  it("treats from == to as the whole day", () => {
    expect(isWithinSchedule({ days: [0], from: "00:00", to: "00:00" }, sd(2026, 10, 25, 13, 0), tz)).toBe(true);
  });
});

describe("parseSchedule / checkWindow", () => {
  it("rejects malformed schedules", () => {
    expect(parseSchedule({ days: [1], from: "8", to: "17:00" })).toBeNull();
    expect(parseSchedule({ days: "x", from: "08:00", to: "17:00" })).toBeNull();
    expect(parseSchedule(null)).toBeNull();
  });
  it("checks validity window and schedule together", () => {
    const pass = { validFrom: sd(2026, 10, 1, 0), validUntil: sd(2026, 12, 31, 0), schedule: { days: [1], from: "08:00", to: "17:00" } };
    expect(checkWindow(pass, sd(2026, 10, 26, 10), tz)).toBe("ok");
    expect(checkWindow(pass, sd(2026, 10, 27, 10), tz)).toBe("outside_schedule");
    expect(checkWindow(pass, sd(2026, 9, 28, 10), tz)).toBe("not_yet_valid");
    expect(checkWindow(pass, sd(2027, 1, 4, 10), tz)).toBe("expired");
  });
});
