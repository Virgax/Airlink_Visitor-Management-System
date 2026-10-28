import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";
import { randomToken } from "@/lib/crypto/tokens";
import { verifyPassword } from "@/lib/auth/password";
import { kioskRoute } from "@/lib/guard/route";
import { policyFlags } from "@/lib/guard/decide";
import type { ScanResponse } from "@/lib/guard/types";
import { validatePassState } from "@/lib/passes/validate";
import { isPassPin, matchPin, normalizePin, pinCandidates, type PinCandidate } from "@/lib/people/pin";
import { enterWithPass, findBlacklistHit, findOpenVisit, loadPass, passInfo, reportBlacklistHit } from "@/lib/server/scan";
import { checkoutVisit, visitJson } from "@/lib/server/visits";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pin: z.string().trim().min(4).max(12),
  /** Optional name fragment typed by the guard to narrow the candidates. */
  name: z.string().trim().max(120).optional(),
});

/**
 * Kiosk PIN entry: the visitor types the 6-digit PIN of their pass (or of their frequent-visitor card). Candidates
 * are the site's passes valid right now that carry a PIN hash; the first scrypt match enters through the same path
 * as a QR scan (`enterWithPass`), or marks the exit when that pass already has an open visit.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return kioskRoute(async (kiosk) => {
    const { user, device, site, gate } = kiosk;
    const limit = await rateLimit(`pin-entry:device:${device.id}`, 10, 60);
    if (!limit.ok) return Response.json({ ok: false, reason: "rate_limited" } satisfies ScanResponse, { status: 429 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, reason: "invalid_body" } satisfies ScanResponse, { status: 400 });
    const pin = normalizePin(parsed.data.pin);
    if (!isPassPin(pin)) return Response.json({ ok: false, reason: "invalid_body" } satisfies ScanResponse, { status: 400 });
    const now = new Date();

    const select = { id: true, siteId: true, status: true, validFrom: true, validUntil: true, schedule: true, visitorName: true, pinHash: true } as const;
    const [passes, frequent] = await Promise.all([
      db.pass.findMany({ where: { siteId: site.id, status: "active", pinHash: { not: null }, validFrom: { lte: now }, validUntil: { gt: now } }, select, take: 500 }),
      db.frequentVisitor.findMany({
        where: { siteId: site.id, active: true, signIn: "pin", pinHash: { not: null }, pass: { status: "active", validFrom: { lte: now }, validUntil: { gt: now } } },
        select: { pinHash: true, pass: { select } },
        take: 500,
      }),
    ]);
    const rows: PinCandidate[] = [
      ...passes.map((p) => ({ passId: p.id, pinHash: p.pinHash!, siteId: p.siteId, status: p.status, validFrom: p.validFrom, validUntil: p.validUntil, schedule: p.schedule ?? undefined, visitorName: p.visitorName, source: "pass" as const })),
      ...frequent.filter((f) => f.pass).map((f) => ({ passId: f.pass!.id, pinHash: f.pinHash!, siteId: f.pass!.siteId, status: f.pass!.status, validFrom: f.pass!.validFrom, validUntil: f.pass!.validUntil, schedule: f.pass!.schedule ?? undefined, visitorName: f.pass!.visitorName, source: "frequent" as const })),
    ];
    const candidates = pinCandidates(rows, { siteId: site.id, timeZone: site.timezone, now, name: parsed.data.name });
    const match = await matchPin(pin, candidates, verifyPassword);
    if (!match) {
      await audit({ action: "visit.denied", siteId: site.id, actorId: user.id, meta: { reason: "pin_not_found", gateId: gate.id, candidates: candidates.length } });
      log.info("guard.pin_denied", { reason: "not_found", deviceId: device.id, candidates: candidates.length });
      return Response.json({ ok: false, reason: "not_found" } satisfies ScanResponse);
    }

    const pass = await loadPass(match.passId);
    if (!pass || pass.siteId !== site.id) return Response.json({ ok: false, reason: "not_found" } satisfies ScanResponse);
    const info = await passInfo(pass, site.id);
    const scanId = `pin-${randomToken(12)}`;

    const openVisit = await findOpenVisit(pass.id, site.id);
    if (openVisit) {
      const visit = await checkoutVisit(openVisit.id, site.id, user.id, now);
      return Response.json({ ok: true, action: "left", visit: visitJson(visit), pass: info } satisfies ScanResponse);
    }

    const hit = await findBlacklistHit(pass, site.id, now);
    const policy = policyFlags(pass.kind, await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId: site.id, kind: pass.kind } } }));
    const state = validatePassState(
      { ...pass, schedule: pass.schedule ?? undefined },
      { siteId: site.id, gateId: gate.id, timeZone: site.timezone, now, blacklisted: Boolean(hit), companyBlocked: Boolean(pass.company?.blocked), policy },
    );
    if (!state.ok) {
      if (state.reason === "blacklisted" && hit) await reportBlacklistHit(pass, hit, kiosk, { scanId, via: "pin" });
      log.info("guard.pin_denied", { reason: state.reason, passId: pass.id, deviceId: device.id });
      return Response.json({ ok: false, reason: state.reason, pass: info } satisfies ScanResponse);
    }

    const result = await enterWithPass({ pass, info, kiosk, scanId, at: now, now, conflict: false, offline: false, via: "pin" });
    return Response.json(result satisfies ScanResponse);
  });
}
