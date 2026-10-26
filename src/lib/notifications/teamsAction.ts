import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto/tokens";

/** What a Teams card button is allowed to do. The token is the only credential: keep TTLs short. */
export type TeamsAction = {
  kind: "visit" | "pass";
  id: string;
  decision: "approved" | "denied";
  /** Unix seconds. */
  exp: number;
};

export const TEAMS_ACTION_TTL_SECONDS: Record<TeamsAction["kind"], number> = {
  visit: 60 * 60,
  pass: 24 * 60 * 60,
};

const KINDS = new Set<TeamsAction["kind"]>(["visit", "pass"]);
const DECISIONS = new Set<TeamsAction["decision"]>(["approved", "denied"]);

function body(a: Omit<TeamsAction, "exp"> & { exp: number }): string {
  return `${a.kind}.${a.id}.${a.decision}.${a.exp}`;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`teams-action:${payload}`).digest("base64url");
}

/** `kind.id.decision.exp.sig`; ids are cuids (no dots). */
export function signTeamsAction(action: Omit<TeamsAction, "exp"> & { exp?: number }, secret: string, now = new Date()): string {
  if (!secret) throw new Error("TEAMS_ACTION_SECRET is required to sign Teams actions");
  if (action.id.includes(".")) throw new Error("Invalid id");
  const exp = action.exp ?? Math.floor(now.getTime() / 1000) + TEAMS_ACTION_TTL_SECONDS[action.kind];
  const payload = body({ ...action, exp });
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the action or null when the token is malformed, tampered with or expired. */
export function verifyTeamsAction(token: string | null | undefined, secret: string, now = new Date()): TeamsAction | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [kind, id, decision, expStr, sig] = parts as [string, string, string, string, string];
  if (!KINDS.has(kind as TeamsAction["kind"]) || !DECISIONS.has(decision as TeamsAction["decision"])) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^\d{1,12}$/.test(expStr)) return null;
  const payload = `${kind}.${id}.${decision}.${expStr}`;
  if (!safeEqual(sig, sign(payload, secret))) return null;
  const exp = Number(expStr);
  if (exp < Math.floor(now.getTime() / 1000)) return null;
  return { kind: kind as TeamsAction["kind"], id, decision: decision as TeamsAction["decision"], exp };
}
