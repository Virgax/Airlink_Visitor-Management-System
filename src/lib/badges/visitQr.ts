/**
 * The QR printed on the badge identifies the *visit* (not the pass, which is already consumed): `visitId.sig` with
 * sig = HMAC-SHA256(PASS_SIGNING_KEY, `visit|${visitId}|${siteId}`) truncated to 16 bytes, base64url.
 * Two dot-separated parts, so it never collides with pass payloads (`passId.exp.sig`, three parts).
 * Pure; the scan route loads the visit and checks the signature with its own site id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIG_BYTES = 16;

function sig(key: string, visitId: string, siteId: string): string {
  return createHmac("sha256", key).update(`visit|${visitId}|${siteId}`).digest().subarray(0, SIG_BYTES).toString("base64url");
}

function eq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function signVisitQr(input: { visitId: string; siteId: string }, key: string): string {
  return `${input.visitId}.${sig(key, input.visitId, input.siteId)}`;
}

export type ParsedVisitQr = { visitId: string; signature: string };

/** Shape check only (no crypto): `visitId.sig`. Null for anything else, including pass payloads. */
export function parseVisitQr(payload: string): ParsedVisitQr | null {
  const parts = payload.trim().split(".");
  if (parts.length !== 2) return null;
  const [visitId, signature] = parts as [string, string];
  if (!/^[a-z0-9]+$/i.test(visitId) || !/^[A-Za-z0-9_-]{16,}$/.test(signature)) return null;
  return { visitId, signature };
}

export type VisitQrResult = { ok: true; visitId: string } | { ok: false; reason: "malformed" | "bad_signature" };

export function verifyVisitQr(payload: string, ctx: { siteId: string; key: string }): VisitQrResult {
  const parsed = parseVisitQr(payload);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (!eq(parsed.signature, sig(ctx.key, parsed.visitId, ctx.siteId))) return { ok: false, reason: "bad_signature" };
  return { ok: true, visitId: parsed.visitId };
}
