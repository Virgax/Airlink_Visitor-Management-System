import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";
import { kioskRoute } from "@/lib/guard/route";
import { passIdFromPayload } from "@/lib/guard/payload";
import { decideScan, policyFlags, validationInstant } from "@/lib/guard/decide";
import type { ScanResponse } from "@/lib/guard/types";
import { parseVisitQr, verifyVisitQr } from "@/lib/badges/visitQr";
import { enterWithPass, findBlacklistHit, findOpenVisit, loadPass, passInfo, passInfoFromVisit, reportBlacklistHit } from "@/lib/server/scan";
import { checkoutVisit, visitJson, visitSummarySelect } from "@/lib/server/visits";
import { verifyAtCheckpoint } from "@/lib/server/checkpoint";
import { registrationPending } from "@/lib/passes/visitor";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  payload: z.string().trim().min(3).max(200),
  scanId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  at: z.string().datetime({ offset: true }).optional(),
  /** Set by the kiosk when the scan was validated offline and flushed from the queue. */
  offline: z.boolean().optional(),
});

/** Kiosk scan: validates the QR, consumes a use, creates the Visit (or marks the exit on a second scan). */
export async function POST(request: NextRequest): Promise<Response> {
  return kioskRoute(async (kiosk) => {
    const { user, device, site, gate } = kiosk;
    const limit = await rateLimit(`scan:device:${device.id}`, 120, 60);
    if (!limit.ok) return Response.json({ ok: false, reason: "rate_limited" } satisfies ScanResponse, { status: 429 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, reason: "invalid_body" } satisfies ScanResponse, { status: 400 });
    const { payload, scanId } = parsed.data;
    const offline = parsed.data.offline === true;
    const now = new Date();
    const at = validationInstant(parsed.data.at ? new Date(parsed.data.at) : null, offline, now);

    // Verification-only post: show the visit and whether it may be here; never enter, consume or close anything.
    if (gate.kind === "checkpoint") return Response.json(await verifyAtCheckpoint({ payload, scanId, kiosk, now }));

    // Idempotency: a scan already recorded (queued twice, double tap) returns the same visit.
    const existing = await db.visit.findUnique({ where: { scanId }, select: visitSummarySelect });
    if (existing && existing.siteId === site.id) {
      const pass = existing.passId ? await loadPass(existing.passId) : null;
      const info = pass ? await passInfo(pass, site.id) : null;
      return Response.json({ ok: true, action: "entered", duplicate: true, visit: visitJson(existing), pass: info ?? passInfoFromVisit(existing) } satisfies ScanResponse);
    }

    // A badge QR (`visitId.sig`) checks the visitor out; it never creates a visit.
    if (parseVisitQr(payload)) {
      const res = verifyVisitQr(payload, { siteId: site.id, key: await getSecret("PASS_SIGNING_KEY") });
      if (!res.ok) {
        log.info("guard.scan_denied", { reason: res.reason, badge: true, deviceId: device.id });
        return Response.json({ ok: false, reason: res.reason } satisfies ScanResponse);
      }
      const badgeVisit = await db.visit.findFirst({ where: { id: res.visitId, siteId: site.id }, select: visitSummarySelect });
      if (!badgeVisit) return Response.json({ ok: false, reason: "not_found" } satisfies ScanResponse);
      if (badgeVisit.status !== "inside" && badgeVisit.status !== "at_dock") {
        return Response.json({ ok: false, reason: "visit_closed", pass: passInfoFromVisit(badgeVisit) } satisfies ScanResponse);
      }
      const left = await checkoutVisit(badgeVisit.id, site.id, user.id, now);
      log.info("guard.scan_badge_left", { visitId: left.id, deviceId: device.id });
      return Response.json({ ok: true, action: "left", visit: visitJson(left), pass: passInfoFromVisit(left) } satisfies ScanResponse);
    }

    const passId = passIdFromPayload(payload);
    const pass = passId ? await loadPass(passId) : null;
    if (pass && pass.siteId !== site.id) {
      // Another site's pass: deny without revealing who it belongs to.
      await audit({ action: "visit.denied", siteId: site.id, actorId: user.id, targetType: "Pass", targetId: pass.id, meta: { reason: "wrong_site", gateId: gate.id, scanId } });
      log.info("guard.scan_denied", { reason: "wrong_site", passId: pass.id, deviceId: device.id });
      return Response.json({ ok: false, reason: "wrong_site" } satisfies ScanResponse);
    }
    const info = pass ? await passInfo(pass, site.id) : null;

    const hit = pass ? await findBlacklistHit(pass, site.id, now) : null;
    const openVisit = pass ? await findOpenVisit(pass.id, site.id) : null;
    const policy = pass ? policyFlags(pass.kind, await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId: site.id, kind: pass.kind } } })) : null;

    const decision = decideScan({
      payload,
      pass: pass ? { ...pass, schedule: pass.schedule ?? undefined, registrationPending: registrationPending(pass) } : null,
      ctx: {
        siteId: site.id,
        gateId: gate.id,
        timeZone: site.timezone,
        key: await getSecret("PASS_SIGNING_KEY"),
        now: at,
        blacklisted: Boolean(hit),
        companyBlocked: Boolean(pass?.company?.blocked),
        policy,
      },
      hasOpenVisit: Boolean(openVisit),
      offline,
    });

    if (decision.action === "deny") {
      if (decision.reason === "blacklisted" && pass && hit) await reportBlacklistHit(pass, hit, kiosk, { scanId });
      log.info("guard.scan_denied", { reason: decision.reason, passId: pass?.id ?? null, deviceId: device.id });
      return Response.json({ ok: false, reason: decision.reason, ...(info ? { pass: info } : {}) } satisfies ScanResponse);
    }

    if (decision.action === "checkout" && pass && openVisit) {
      const visit = await checkoutVisit(openVisit.id, site.id, user.id, now);
      return Response.json({ ok: true, action: "left", visit: visitJson(visit), pass: info! } satisfies ScanResponse);
    }

    if (!pass || !info) return Response.json({ ok: false, reason: "not_found" } satisfies ScanResponse);

    const result = await enterWithPass({ pass, info, kiosk, scanId, at, now, conflict: decision.action === "enter" && decision.conflict, offline, via: "qr" });
    return Response.json(result satisfies ScanResponse);
  });
}
