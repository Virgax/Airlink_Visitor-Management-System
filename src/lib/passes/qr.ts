/**
 * Which QR a pass shows and its current payload. Pure: the signing key is a parameter.
 * Static passes carry `passId.exp.sig` with exp = validUntil; recurring passes rotate every ROTATION_STEP_SEC.
 */
import type { VisitKind } from "@prisma/client";
import { ROTATION_STEP_SEC, signRotatingQr, signStaticQr } from "@/lib/passes/validate";

export type QrPass = { id: string; siteId: string; kind: VisitKind; schedule?: unknown; validUntil: Date };

export type QrPayloadInfo = {
  payload: string;
  rotating: boolean;
  /** Seconds until the payload changes (rotating) or null for static. */
  refreshInSec: number | null;
  /** Unix seconds when the payload stops being accepted. */
  expiresAt: number;
};

export function isRotatingPass(pass: Pick<QrPass, "kind" | "schedule">): boolean {
  return pass.kind === "recurring" || (pass.schedule !== null && pass.schedule !== undefined);
}

export function qrPayloadFor(pass: QrPass, now: Date, key: string): QrPayloadInfo {
  const nowSec = Math.floor(now.getTime() / 1000);
  if (isRotatingPass(pass)) {
    const stepEnd = (Math.floor(nowSec / ROTATION_STEP_SEC) + 1) * ROTATION_STEP_SEC;
    return {
      payload: signRotatingQr({ passId: pass.id, siteId: pass.siteId, now: now.getTime() }, key),
      rotating: true,
      refreshInSec: Math.max(1, stepEnd - nowSec),
      expiresAt: stepEnd + ROTATION_STEP_SEC,
    };
  }
  const exp = Math.floor(pass.validUntil.getTime() / 1000);
  return { payload: signStaticQr({ passId: pass.id, exp, siteId: pass.siteId }, key), rotating: false, refreshInSec: null, expiresAt: exp };
}
