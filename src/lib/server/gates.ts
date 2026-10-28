import "server-only";
import type { Gate, VisitKind } from "@prisma/client";
import { VISIT_KINDS } from "@/lib/passes/form";

/** Typed view of `Gate.settings` (JSON). Unknown keys (e.g. slice F's `printer`) are kept as they are. */
export type GateSettings = { selfSignInKinds: VisitKind[] } & Record<string, unknown>;

export function readGateSettings(gate: Pick<Gate, "settings">): GateSettings {
  const raw = gate.settings && typeof gate.settings === "object" && !Array.isArray(gate.settings) ? (gate.settings as Record<string, unknown>) : {};
  const kinds = Array.isArray(raw.selfSignInKinds) ? raw.selfSignInKinds.filter((k): k is VisitKind => typeof k === "string" && (VISIT_KINDS as string[]).includes(k)) : [];
  return { ...raw, selfSignInKinds: kinds };
}

/** Public self sign-in URL for a gate token (what the poster QR encodes). */
export function selfSignInPath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}
