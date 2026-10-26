import { describe, expect, it } from "vitest";
import { buildSchedule, checkWindowRange, groupVisitorNames, parseGroupSize, uniqueIds } from "@/lib/passes/form";

describe("buildSchedule", () => {
  it("builds a schedule from checkbox values (strings), de-duplicated and sorted", () => {
    expect(buildSchedule({ days: ["5", "1", "1", "3"], from: "8:00", to: "17:30" })).toEqual({ days: [1, 3, 5], from: "08:00", to: "17:30" });
  });
  it("accepts a single value (one checkbox) and numbers", () => {
    expect(buildSchedule({ days: "2", from: "22:00", to: "06:00" })).toEqual({ days: [2], from: "22:00", to: "06:00" });
    expect(buildSchedule({ days: [0, 6], from: "09:00", to: "12:00" })?.days).toEqual([0, 6]);
  });
  it("rejects missing days, bad hours or out-of-range days", () => {
    expect(buildSchedule({ days: [], from: "08:00", to: "17:00" })).toBeNull();
    expect(buildSchedule({ days: ["7", "-1"], from: "08:00", to: "17:00" })).toBeNull();
    expect(buildSchedule({ days: ["1"], from: "25:00", to: "17:00" })).toBeNull();
    expect(buildSchedule({ days: ["1"], from: "", to: "17:00" })).toBeNull();
    expect(buildSchedule({ days: undefined, from: "08:00", to: "17:00" })).toBeNull();
  });
});

describe("groupVisitorNames", () => {
  it("keeps the lead name and numbers the rest", () => {
    expect(groupVisitorNames("Juan Pérez", 1)).toEqual(["Juan Pérez"]);
    expect(groupVisitorNames(" Juan Pérez ", 3)).toEqual(["Juan Pérez", "Visitante 2", "Visitante 3"]);
    expect(groupVisitorNames("Lead", 2, "Visitor")).toEqual(["Lead", "Visitor 2"]);
  });
  it("clamps the group size", () => {
    expect(parseGroupSize("0")).toBe(1);
    expect(parseGroupSize("abc")).toBe(1);
    expect(parseGroupSize("2.5")).toBe(1);
    expect(parseGroupSize("999")).toBe(50);
    expect(groupVisitorNames("x", 999)).toHaveLength(50);
  });
});

describe("checkWindowRange", () => {
  const now = new Date("2026-10-26T15:00:00Z");
  it("requires from < until, within a year and not already over", () => {
    expect(checkWindowRange(new Date("2026-10-27T12:00Z"), new Date("2026-10-27T14:00Z"), now)).toBeNull();
    expect(checkWindowRange(new Date("2026-10-27T14:00Z"), new Date("2026-10-27T12:00Z"), now)).toBe("window_order");
    expect(checkWindowRange(new Date("2026-10-27T12:00Z"), new Date("2028-01-01T12:00Z"), now)).toBe("window_too_long");
    expect(checkWindowRange(new Date("2026-10-01T12:00Z"), new Date("2026-10-02T12:00Z"), now)).toBe("window_past");
  });
});

describe("uniqueIds", () => {
  it("keeps only well-formed ids, once each", () => {
    expect(uniqueIds(["a1", "a1", " b2 ", "bad id", "x".repeat(65)])).toEqual(["a1", "b2"]);
    expect(uniqueIds(undefined)).toEqual([]);
    expect(uniqueIds("solo")).toEqual(["solo"]);
  });
});
