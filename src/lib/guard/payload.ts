/**
 * QR payload parsing without any crypto, safe for the browser (the signing key never leaves the server).
 * Mirrors the shape accepted by `parseQr` in `src/lib/passes/validate.ts`: `passId.exp.sig` or `passId.r<step>.sig`.
 */
export type PayloadShape =
  | { kind: "static"; passId: string; exp: number }
  | { kind: "rotating"; passId: string; step: number };

export function parsePayloadShape(payload: string): PayloadShape | null {
  const parts = payload.trim().split(".");
  if (parts.length !== 3) return null;
  const [passId, second, signature] = parts as [string, string, string];
  if (!passId || !second || !signature) return null;
  if (!/^[a-z0-9]+$/i.test(passId) || !/^r?[a-z0-9]+$/i.test(second)) return null;
  if (second.startsWith("r")) {
    const step = parseInt(second.slice(1), 36);
    if (!Number.isFinite(step)) return null;
    return { kind: "rotating", passId, step };
  }
  const exp = parseInt(second, 36);
  if (!Number.isFinite(exp)) return null;
  return { kind: "static", passId, exp };
}

/** The pass id inside a payload, or null when the payload is malformed. */
export function passIdFromPayload(payload: string): string | null {
  return parsePayloadShape(payload)?.passId ?? null;
}
