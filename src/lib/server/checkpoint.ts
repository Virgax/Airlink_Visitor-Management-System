import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSecret } from "@/lib/secrets";
import type { KioskContext } from "@/lib/auth/kiosk";
import { checkpointDecision, readCheckpointAreaIds } from "@/lib/guard/checkpoint";
import { passIdFromPayload } from "@/lib/guard/payload";
import type { ScanResponse } from "@/lib/guard/types";
import { parseVisitQr, verifyVisitQr } from "@/lib/badges/visitQr";
import { verifyQr } from "@/lib/passes/validate";
import { findOpenVisit, loadPass, passInfo, passInfoFromVisit } from "@/lib/server/scan";
import { visitJson, visitSummarySelect } from "@/lib/server/visits";
import { log } from "@/lib/log";

/**
 * Scan at a verification-only gate: the badge QR (`visitId.sig`) or the pass QR identifies a visit that must be
 * inside the site; the answer says whether its areas allow this checkpoint. Nothing is consumed, entered or closed;
 * every check is audited (`visit.checkpoint`) so the report shows who passed which post and when.
 */
export async function verifyAtCheckpoint(input: { payload: string; scanId: string; kiosk: KioskContext; now?: Date }): Promise<ScanResponse> {
  const { payload, scanId, kiosk } = input;
  const { site, gate, user, device } = kiosk;
  const now = input.now ?? new Date();
  const key = await getSecret("PASS_SIGNING_KEY");

  let visitId: string | null = null;
  if (parseVisitQr(payload)) {
    const res = verifyVisitQr(payload, { siteId: site.id, key });
    if (!res.ok) return { ok: false, reason: res.reason };
    visitId = res.visitId;
  } else {
    const passId = passIdFromPayload(payload);
    const pass = passId ? await loadPass(passId) : null;
    if (!pass) return { ok: false, reason: "not_found" };
    if (pass.siteId !== site.id) return { ok: false, reason: "wrong_site" };
    // Authenticity only: an expired static QR still identifies the visit the guard wants to verify.
    const qr = verifyQr(payload, { siteId: site.id, key, now: now.getTime() });
    if (!qr.ok && (qr.reason === "malformed" || qr.reason === "bad_signature")) return { ok: false, reason: qr.reason };
    const open = await findOpenVisit(pass.id, site.id);
    if (!open) {
      await audit({ action: "visit.checkpoint", siteId: site.id, actorId: user.id, targetType: "Pass", targetId: pass.id, meta: { gateId: gate.id, scanId, result: "not_inside" } });
      return { ok: false, reason: "not_inside", pass: await passInfo(pass, site.id) };
    }
    visitId = open.id;
  }

  const visit = await db.visit.findFirst({ where: { id: visitId, siteId: site.id }, select: visitSummarySelect });
  if (!visit) return { ok: false, reason: "not_found" };
  if (visit.status !== "inside" && visit.status !== "at_dock") {
    await audit({ action: "visit.checkpoint", siteId: site.id, actorId: user.id, targetType: "Visit", targetId: visit.id, meta: { gateId: gate.id, scanId, result: "visit_closed" } });
    return { ok: false, reason: "visit_closed", pass: passInfoFromVisit(visit) };
  }

  const controlledIds = readCheckpointAreaIds(gate.settings);
  const decision = checkpointDecision(visit.areaIds, controlledIds);
  const [controlled, pass] = await Promise.all([
    controlledIds.length ? db.area.findMany({ where: { id: { in: controlledIds }, siteId: site.id }, select: { name: true }, orderBy: { name: "asc" } }) : [],
    visit.passId ? loadPass(visit.passId) : null,
  ]);
  const info = pass ? await passInfo(pass, site.id) : passInfoFromVisit(visit);
  if (!pass && visit.areaIds.length) {
    const areas = await db.area.findMany({ where: { id: { in: visit.areaIds }, siteId: site.id }, select: { name: true } });
    info.areas = areas.map((a) => a.name);
  }
  await audit({
    action: "visit.checkpoint",
    siteId: site.id,
    actorId: user.id,
    targetType: "Visit",
    targetId: visit.id,
    meta: { gateId: gate.id, scanId, result: decision.allowed ? "allowed" : "area_not_allowed", matchedAreaIds: decision.matchedAreaIds },
  });
  log.info("guard.checkpoint", { visitId: visit.id, gateId: gate.id, deviceId: device.id, allowed: decision.allowed });
  return {
    ok: true,
    action: "verified",
    visit: visitJson(visit),
    pass: info,
    checkpoint: { allowed: decision.allowed, controlledAreas: controlled.map((a) => a.name), enteredAt: visit.enteredAt?.toISOString() ?? null, badgeNo: visit.badgeNo },
  };
}
