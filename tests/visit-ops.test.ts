import { describe, expect, it } from "vitest";
import { autoCloseDue, autoCloseInstant, normalizeAutoSignOutAt, parseEmailList } from "@/lib/policies/autoClose";
import { filtersToQuery, PAGE_SIZES, parseShiftLogFilters, parseVisitFilters, quickRangeDays, REPORT_PAGE_SIZE } from "@/lib/server/reports-filters";

const TZ = "America/Santo_Domingo"; // UTC-4, no DST

describe("auto sign-out instant", () => {
  it("normalizes HH:mm input and rejects invalid times", () => {
    expect(normalizeAutoSignOutAt("8:5")).toBe("08:05");
    expect(normalizeAutoSignOutAt(" 23:59 ")).toBe("23:59");
    expect(normalizeAutoSignOutAt("24:00")).toBeNull();
    expect(normalizeAutoSignOutAt("12:60")).toBeNull();
    expect(normalizeAutoSignOutAt("noon")).toBeNull();
  });
  it("closes at the same local day's cutoff when the visit entered before it", () => {
    const enteredAt = new Date("2026-03-10T14:00:00Z"); // 10:00 local
    expect(autoCloseInstant(enteredAt, "18:00", TZ)?.toISOString()).toBe("2026-03-10T22:00:00.000Z");
  });
  it("rolls to the next day when the visit entered after the cutoff (night shift)", () => {
    const enteredAt = new Date("2026-03-11T01:30:00Z"); // 21:30 local on March 10
    expect(autoCloseInstant(enteredAt, "18:00", TZ)?.toISOString()).toBe("2026-03-11T22:00:00.000Z");
  });
  it("handles midnight-ish cutoffs across the day boundary", () => {
    const enteredAt = new Date("2026-03-10T23:30:00Z"); // 19:30 local
    expect(autoCloseInstant(enteredAt, "23:59", TZ)?.toISOString()).toBe("2026-03-11T03:59:00.000Z");
    expect(autoCloseInstant(enteredAt, "00:00", TZ)?.toISOString()).toBe("2026-03-11T04:00:00.000Z");
  });
  it("respects DST in zones that have it", () => {
    // New York: 2026-03-08 02:00 → EDT. A visit at 01:00 EST closes at 03:00 EDT (07:00Z), not at 08:00Z.
    const enteredAt = new Date("2026-03-08T06:00:00Z");
    expect(autoCloseInstant(enteredAt, "03:00", "America/New_York")?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
  it("is due only once now has reached the cutoff, and returns the cutoff as leftAt", () => {
    const enteredAt = new Date("2026-03-10T14:00:00Z");
    expect(autoCloseDue(enteredAt, "18:00", TZ, new Date("2026-03-10T21:59:59Z"))).toBeNull();
    expect(autoCloseDue(enteredAt, "18:00", TZ, new Date("2026-03-10T22:00:00Z"))?.toISOString()).toBe("2026-03-10T22:00:00.000Z");
    expect(autoCloseDue(enteredAt, "18:00", TZ, new Date("2026-03-12T09:00:00Z"))?.toISOString()).toBe("2026-03-10T22:00:00.000Z");
    expect(autoCloseDue(enteredAt, "bogus", TZ, new Date("2026-03-12T09:00:00Z"))).toBeNull();
  });
});

describe("notifyEmails list", () => {
  it("splits on commas/semicolons/newlines, lowercases, dedupes and validates", () => {
    expect(parseEmailList(" Seguridad@Airlink.com, rrhh@airlink.com;seguridad@airlink.com\nit@airlink.com ")).toEqual(["seguridad@airlink.com", "rrhh@airlink.com", "it@airlink.com"]);
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList("not-an-email")).toBeNull();
    expect(parseEmailList("a@b.c, ok@airlink.com")).toBeNull();
    expect(parseEmailList(Array.from({ length: 21 }, (_, i) => `u${i}@airlink.com`).join(","))).toBeNull();
  });
});

describe("quick ranges", () => {
  const now = new Date("2026-03-11T02:30:00Z"); // Tuesday March 10, 22:30 in Santo Domingo
  it("resolves today, yesterday, Monday–today and 1st–today in the site's zone", () => {
    expect(quickRangeDays("today", now, TZ)).toEqual({ from: "2026-03-10", to: "2026-03-10" });
    expect(quickRangeDays("yesterday", now, TZ)).toEqual({ from: "2026-03-09", to: "2026-03-09" });
    expect(quickRangeDays("week", now, TZ)).toEqual({ from: "2026-03-09", to: "2026-03-10" });
    expect(quickRangeDays("month", now, TZ)).toEqual({ from: "2026-03-01", to: "2026-03-10" });
  });
  it("treats Sunday as the end of the week that started the previous Monday", () => {
    const sunday = new Date("2026-03-15T16:00:00Z");
    expect(quickRangeDays("week", sunday, TZ)).toEqual({ from: "2026-03-09", to: "2026-03-15" });
  });
  it("`range` in the query wins over from/to and bad ranges are ignored", () => {
    const f = parseVisitFilters({ range: "yesterday", from: "2026-01-01", to: "2026-01-31" }, { timeZone: TZ, now });
    expect(f).toMatchObject({ range: "yesterday", from: "2026-03-09", to: "2026-03-09" });
    const g = parseVisitFilters({ range: "lastyear", from: "2026-01-01", to: "2026-01-31" }, { timeZone: TZ, now });
    expect(g.range).toBeUndefined();
    expect(g).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
  });
});

describe("free text and rows per page", () => {
  it("keeps a trimmed `q` and drops an empty one", () => {
    expect(parseVisitFilters({ q: "  Pérez " }, { timeZone: TZ }).q).toBe("Pérez");
    expect(parseVisitFilters({ q: "   " }, { timeZone: TZ }).q).toBeUndefined();
    expect(parseVisitFilters({ q: "x".repeat(200) }, { timeZone: TZ }).q).toHaveLength(80);
  });
  it("accepts only 25/50/100 as page size (default stays 50)", () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
    expect(REPORT_PAGE_SIZE).toBe(50);
    expect(parseVisitFilters({ pageSize: "25" }, { timeZone: TZ }).pageSize).toBe(25);
    expect(parseVisitFilters({ pageSize: "100" }, { timeZone: TZ }).pageSize).toBe(100);
    expect(parseVisitFilters({ pageSize: "75" }, { timeZone: TZ }).pageSize).toBeUndefined();
    expect(parseVisitFilters({ pageSize: "abc" }, { timeZone: TZ }).pageSize).toBeUndefined();
    expect(parseShiftLogFilters({ pageSize: "100" }, { timeZone: TZ }).pageSize).toBe(100);
  });
  it("carries q, pageSize and range in links", () => {
    expect(filtersToQuery({ from: "2026-03-01", to: "2026-03-01", q: "ABC 123", pageSize: 100, page: 2 })).toBe("?from=2026-03-01&to=2026-03-01&q=ABC+123&pageSize=100&page=2");
    expect(filtersToQuery({ from: "2026-03-01", to: "2026-03-01" }, { range: "today", from: undefined, to: undefined })).toBe("?range=today");
  });
});
