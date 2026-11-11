import { describe, expect, it } from "vitest";


describe("early arrival grace", () => {
  const tz = "America/Santo_Domingo";
  // Pass for 10:00–12:00 local (UTC-4): 14:00Z–16:00Z.
  const pass = { validFrom: new Date("2026-11-11T14:00:00Z"), validUntil: new Date("2026-11-11T16:00:00Z") };

  it("lets the visitor in up to the grace before the start (one hour by default)", async () => {
    const { checkWindow } = await import("@/lib/passes/validate");
    expect(checkWindow(pass, new Date("2026-11-11T13:45:00Z"), tz)).toBe("ok"); // 15 min early
    expect(checkWindow(pass, new Date("2026-11-11T13:00:00Z"), tz)).toBe("ok"); // exactly one hour early
    expect(checkWindow(pass, new Date("2026-11-11T12:59:00Z"), tz)).toBe("not_yet_valid");
    expect(checkWindow(pass, new Date("2026-11-11T13:30:00Z"), tz, 15)).toBe("not_yet_valid"); // site allows 15 min only
    expect(checkWindow(pass, new Date("2026-11-11T13:50:00Z"), tz, 15)).toBe("ok");
    expect(checkWindow(pass, new Date("2026-11-11T13:50:00Z"), tz, 0)).toBe("not_yet_valid");
  });

  it("never opens the pass on the previous day, whatever the grace", async () => {
    const { checkWindow } = await import("@/lib/passes/validate");
    // Pass starting at 00:30 local (04:30Z): with 60 min grace it opens at 00:00 local (04:00Z), not 23:30 the day before.
    const early = { validFrom: new Date("2026-11-11T04:30:00Z"), validUntil: new Date("2026-11-11T10:00:00Z") };
    expect(checkWindow(early, new Date("2026-11-11T04:05:00Z"), tz)).toBe("ok");
    expect(checkWindow(early, new Date("2026-11-11T03:50:00Z"), tz)).toBe("not_yet_valid");
  });

  it("applies the grace to the daily start of recurring passes", async () => {
    const { checkWindow } = await import("@/lib/passes/validate");
    const recurring = { validFrom: new Date("2026-11-01T00:00:00Z"), validUntil: new Date("2026-12-31T00:00:00Z"), schedule: { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00" } };
    // Wednesday 2026-11-11, 07:30 local = 11:30Z
    expect(checkWindow(recurring, new Date("2026-11-11T11:30:00Z"), tz)).toBe("ok");
    expect(checkWindow(recurring, new Date("2026-11-11T11:30:00Z"), tz, 0)).toBe("outside_schedule");
    expect(checkWindow(recurring, new Date("2026-11-11T10:30:00Z"), tz)).toBe("outside_schedule");
  });
});
