import "server-only";
import type { VisitKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { signValue, verifyValue } from "@/lib/crypto/tokens";
import { readGateSettings } from "@/lib/server/gates";
import { enabledKinds } from "@/lib/server/policies";
import { TOKEN_RE } from "@/lib/passes/visitor";

/** How long the visitor's status link (`?k=`) stays valid. */
const VISIT_KEY_TTL_SEC = 12 * 3600;

export type SelfSignInGate = {
  id: string;
  name: string;
  site: { id: string; name: string; timezone: string; address: string | null };
  /** Kinds a walk-in may pick: the gate's `selfSignInKinds` (or every kind) minus the kinds disabled in the policies. */
  kinds: VisitKind[];
};

/** Resolves a gate from its public self sign-in token (active gate of an active site), or null. */
export async function loadSelfSignInGate(token: string): Promise<SelfSignInGate | null> {
  if (!TOKEN_RE.test(token)) return null;
  const gate = await db.gate.findUnique({
    where: { selfSignInToken: token },
    select: { id: true, name: true, active: true, settings: true, site: { select: { id: true, name: true, timezone: true, address: true, active: true } } },
  });
  if (!gate || !gate.active || !gate.site.active) return null;
  const enabled = await enabledKinds(gate.site.id);
  const chosen = readGateSettings(gate).selfSignInKinds;
  const kinds = (chosen.length ? chosen : enabled).filter((k) => enabled.includes(k));
  return { id: gate.id, name: gate.name, site: { id: gate.site.id, name: gate.site.name, timezone: gate.site.timezone, address: gate.site.address }, kinds };
}

/** Signed key that lets the visitor (and only them) poll the status of the visit they just registered. */
export async function signVisitKey(visitId: string): Promise<string> {
  return signValue(visitId, await getSecret("SESSION_SECRET"), VISIT_KEY_TTL_SEC);
}

export async function verifyVisitKey(key: string | undefined, visitId: string): Promise<boolean> {
  if (!key || key.length > 256) return false;
  const value = verifyValue(key, await getSecret("SESSION_SECRET"));
  return value !== null && value === visitId;
}

/** What the visitor's status page shows: no document, no host contact details. */
export const selfVisitSelect = { id: true, status: true, visitorName: true, siteId: true, gateId: true, host: { select: { name: true } }, gate: { select: { name: true } } } as const;

export function selfVisitJson(v: { id: string; status: string; visitorName: string; host: { name: string } | null; gate: { name: string } }) {
  return { id: v.id, status: v.status, visitorName: v.visitorName, hostName: v.host?.name ?? null, gateName: v.gate.name };
}
