import { describe, expect, it } from "vitest";
import { flushScans, outcomeForStatus, type QueuedScan } from "@/lib/offline/queue";
import { cacheIsFresh, provisionalCheck, type PassCache } from "@/lib/offline/provisional";

const now = new Date(Date.UTC(2026, 9, 26, 15, 0, 0));
const exp36 = Math.floor(now.getTime() / 1000 + 3600).toString(36);
const payload = `p1.${exp36}.sig`;

const cache: PassCache = {
  generatedAt: new Date(now.getTime() - 60_000).toISOString(),
  blacklistCount: 0,
  passes: [
    { id: "p1", kind: "visit", visitorName: "Ana", company: null, host: "Luis", validFrom: new Date(now.getTime() - 3600_000).toISOString(), validUntil: new Date(now.getTime() + 3600_000).toISOString(), maxUses: 1, uses: 0, warnings: [], areas: [] },
    { id: "p2", kind: "visit", visitorName: "Bea", company: null, host: "Luis", validFrom: new Date(now.getTime() + 3600_000).toISOString(), validUntil: new Date(now.getTime() + 7200_000).toISOString(), maxUses: 1, uses: 0, warnings: [], areas: [] },
    { id: "p3", kind: "visit", visitorName: "Cao", company: null, host: "Luis", validFrom: new Date(now.getTime() - 3600_000).toISOString(), validUntil: new Date(now.getTime() + 3600_000).toISOString(), maxUses: 1, uses: 1, warnings: [], areas: [] },
  ],
};

describe("provisionalCheck", () => {
  it("accepts a cached, valid pass with a well-formed payload", () => {
    expect(provisionalCheck(cache, payload, now)).toMatchObject({ ok: true, pass: { id: "p1" } });
  });
  it("rejects malformed, unknown, not-yet-valid, spent and stale payloads", () => {
    expect(provisionalCheck(cache, "zzz", now)).toEqual({ ok: false, reason: "malformed" });
    expect(provisionalCheck(cache, `p9.${exp36}.sig`, now)).toEqual({ ok: false, reason: "not_found" });
    expect(provisionalCheck(null, payload, now)).toEqual({ ok: false, reason: "not_found" });
    expect(provisionalCheck(cache, `p2.${exp36}.sig`, now)).toMatchObject({ ok: false, reason: "not_yet_valid" });
    expect(provisionalCheck(cache, `p3.${exp36}.sig`, now)).toMatchObject({ ok: false, reason: "no_uses_left" });
    const past36 = Math.floor(now.getTime() / 1000 - 10).toString(36);
    expect(provisionalCheck(cache, `p1.${past36}.sig`, now)).toMatchObject({ ok: false, reason: "qr_expired" });
    const far36 = Math.floor(now.getTime() / 1000 + 86_400).toString(36);
    expect(provisionalCheck(cache, `p1.${far36}.sig`, new Date(now.getTime() + 2 * 3600_000))).toMatchObject({ ok: false, reason: "expired" });
  });
  it("treats an old cache as untrusted", () => {
    expect(cacheIsFresh(cache, now)).toBe(true);
    expect(cacheIsFresh({ ...cache, generatedAt: new Date(now.getTime() - 7 * 3600_000).toISOString() }, now)).toBe(false);
    expect(cacheIsFresh(null, now)).toBe(false);
  });
});

describe("flushScans", () => {
  const scans: QueuedScan[] = [
    { scanId: "a", payload: "p1.x.y", at: "2026-10-26T15:00:00Z", attempts: 0 },
    { scanId: "b", payload: "p2.x.y", at: "2026-10-26T15:01:00Z", attempts: 0 },
    { scanId: "c", payload: "p3.x.y", at: "2026-10-26T15:02:00Z", attempts: 0 },
  ];
  it("removes sent and dropped scans, keeps the rest in order", async () => {
    const res = await flushScans(scans, async (s) => (s.scanId === "b" ? "drop" : "sent"));
    expect(res).toEqual({ sent: ["a", "c"], kept: [], dropped: ["b"] });
  });
  it("stops at the first retryable failure so later scans wait for the network", async () => {
    const posted: string[] = [];
    const res = await flushScans(scans, async (s) => {
      posted.push(s.scanId);
      if (s.scanId === "b") throw new Error("offline");
      return "sent";
    });
    expect(posted).toEqual(["a", "b"]);
    expect(res).toEqual({ sent: ["a"], kept: ["b", "c"], dropped: [] });
  });
  it("drops a scan after too many attempts", async () => {
    const res = await flushScans([{ ...scans[0]!, attempts: 19 }], async () => "retry");
    expect(res.dropped).toEqual(["a"]);
  });
  it("maps HTTP statuses to outcomes", () => {
    expect(outcomeForStatus(200)).toBe("sent");
    expect(outcomeForStatus(400)).toBe("drop");
    expect(outcomeForStatus(401)).toBe("retry");
    expect(outcomeForStatus(429)).toBe("retry");
    expect(outcomeForStatus(503)).toBe("retry");
  });
});
