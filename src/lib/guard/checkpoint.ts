/**
 * Verification-only gates ("punto de control"): a post inside the plant (the stairs to the second floor, a corridor
 * to the secure areas) where security checks the badge of someone who already entered at reception. A scan there
 * never creates a visit nor closes one; it only answers "is this person inside, and may they be here?". Pure.
 */
import { z } from "zod";

/** `Gate.settings.checkpointAreaIds`: the areas this checkpoint protects. Empty = any visitor inside may pass. */
export function readCheckpointAreaIds(gateSettings: unknown): string[] {
  const parsed = z.object({ checkpointAreaIds: z.array(z.string().max(64)).max(100).optional() }).safeParse(gateSettings ?? {});
  return parsed.success ? (parsed.data.checkpointAreaIds ?? []) : [];
}

export type CheckpointDecision = { allowed: boolean; matchedAreaIds: string[] };

/** A visit may pass when the checkpoint controls no area, or when one of the visit's areas is controlled by it. */
export function checkpointDecision(visitAreaIds: readonly string[], checkpointAreaIds: readonly string[]): CheckpointDecision {
  if (checkpointAreaIds.length === 0) return { allowed: true, matchedAreaIds: [] };
  const matchedAreaIds = visitAreaIds.filter((id) => checkpointAreaIds.includes(id));
  return { allowed: matchedAreaIds.length > 0, matchedAreaIds };
}
