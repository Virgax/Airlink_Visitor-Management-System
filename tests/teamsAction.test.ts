import { describe, expect, it } from "vitest";
import { signTeamsAction, TEAMS_ACTION_TTL_SECONDS, verifyTeamsAction } from "@/lib/notifications/teamsAction";

const SECRET = "unit-test-teams-secret";
const NOW = new Date("2026-10-26T12:00:00Z");

describe("Teams action tokens", () => {
  it("round-trips a visit decision with the default TTL", () => {
    const token = signTeamsAction({ kind: "visit", id: "clvisit123", decision: "approved" }, SECRET, NOW);
    expect(token.split(".")).toHaveLength(5);
    const action = verifyTeamsAction(token, SECRET, NOW);
    expect(action).toEqual({ kind: "visit", id: "clvisit123", decision: "approved", exp: Math.floor(NOW.getTime() / 1000) + TEAMS_ACTION_TTL_SECONDS.visit });
  });

  it("round-trips a pass denial", () => {
    const token = signTeamsAction({ kind: "pass", id: "clpass456", decision: "denied" }, SECRET, NOW);
    expect(verifyTeamsAction(token, SECRET, NOW)?.decision).toBe("denied");
    expect(verifyTeamsAction(token, SECRET, NOW)?.kind).toBe("pass");
  });

  it("rejects expiry, tampering and the wrong secret", () => {
    const token = signTeamsAction({ kind: "visit", id: "clvisit123", decision: "approved" }, SECRET, NOW);
    const later = new Date(NOW.getTime() + (TEAMS_ACTION_TTL_SECONDS.visit + 1) * 1000);
    expect(verifyTeamsAction(token, SECRET, later)).toBeNull();
    expect(verifyTeamsAction(token.replace("approved", "denied"), SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction(token.replace("clvisit123", "clvisit999"), SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction(token, "another-secret", NOW)).toBeNull();
    expect(verifyTeamsAction(token.slice(0, -2), SECRET, NOW)).toBeNull();
  });

  it("rejects malformed tokens and empty secrets", () => {
    expect(verifyTeamsAction(null, SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction("", SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction("a.b.c", SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction("user.clvisit123.approved.1.sig", SECRET, NOW)).toBeNull();
    expect(verifyTeamsAction("visit.clvisit123.maybe.1.sig", SECRET, NOW)).toBeNull();
    const token = signTeamsAction({ kind: "visit", id: "clvisit123", decision: "approved" }, SECRET, NOW);
    expect(verifyTeamsAction(token, "", NOW)).toBeNull();
    expect(() => signTeamsAction({ kind: "visit", id: "x", decision: "approved" }, "", NOW)).toThrow();
    expect(() => signTeamsAction({ kind: "visit", id: "a.b", decision: "approved" }, SECRET, NOW)).toThrow();
  });
});
