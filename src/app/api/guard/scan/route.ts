import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import { rateLimit } from "@/lib/rateLimit";
import { kioskRoute } from "@/lib/guard/route";
import { passIdFromPayload } from "@/lib/guard/payload";
import { decideScan, entryStatus, matchBlacklist, passWarnings, policyFlags, validationInstant } from "@/lib/guard/decide";
import type { ScanPassInfo, ScanResponse } from "@/lib/guard/types";
import { consumePassUse } from "@/lib/server/passes";
import { checkoutVisit, notifyEntered, securityRecipientIds, visitJson, visitSummarySelect } from "@/lib/server/visits";
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
  return kioskRoute(async ({ user, device, site, gate }) => {
    const limit = await rateLimit(`scan:device:${device.id}`, 120, 60);
    if (!limit.ok) return Response.json({ ok: false, reason: "rate_limited" } satisfies ScanResponse, { status: 429 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, reason: "invalid_body" } satisfies ScanResponse, { status: 400 });
    const { payload, scanId } = parsed.data;
    const offline = parsed.data.offline === true;
    const now = new Date();
    const at = validationInstant(parsed.data.at ? new Date(parsed.data.at) : null, offline, now);

    // Idempotency: a scan already recorded (queued twice, double tap) returns the same visit.
    const existing = await db.visit.findUnique({ where: { scanId }, select: visitSummarySelect });
    if (existing && existing.siteId === site.id) {
      const pass = existing.passId ? await loadPass(existing.passId) : null;
      const info = pass ? await passInfo(pass, site.id) : null;
      return Response.json({ ok: true, action: "entered", duplicate: true, visit: visitJson(existing), pass: info ?? passInfoFromVisit(existing) } satisfies ScanResponse);
    }

    const passId = passIdFromPayload(payload);
    const pass = passId ? await loadPass(passId) : null;
    const info = pass ? await passInfo(pass, site.id) : null;

    const blacklist = pass && (pass.visitorDocHash || pass.plate)
      ? await db.blacklist.findMany({
          where: { OR: [{ siteId: site.id }, { siteId: null }], AND: { OR: [...(pass.visitorDocHash ? [{ docHash: pass.visitorDocHash }] : []), ...(pass.plate ? [{ plate: pass.plate }] : [])] } },
          select: { id: true, siteId: true, docHash: true, plate: true, until: true },
        })
      : [];
    const hit = pass ? matchBlacklist(blacklist, { docHash: pass.visitorDocHash, plate: pass.plate }, site.id, now) : null;
    const openVisit = pass
      ? await db.visit.findFirst({ where: { passId: pass.id, siteId: site.id, status: { in: ["inside", "at_dock"] } }, select: { id: true }, orderBy: { enteredAt: "desc" } })
      : null;

    const policy = pass ? policyFlags(pass.kind, await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId: site.id, kind: pass.kind } } })) : null;

    const decision = decideScan({
      payload,
      pass: pass ? { ...pass, schedule: pass.schedule ?? undefined } : null,
      ctx: {
        siteId: site.id,
        gateId: gate.id,
        timeZone: site.timezone,
        key: env().PASS_SIGNING_KEY,
        now: at,
        blacklisted: Boolean(hit),
        companyBlocked: Boolean(pass?.company?.blocked),
        policy,
      },
      hasOpenVisit: Boolean(openVisit),
      offline,
    });

    if (decision.action === "deny") {
      if (decision.reason === "blacklisted" && pass && hit) {
        await audit({ action: "blacklist.hit", siteId: site.id, actorId: user.id, targetType: "Pass", targetId: pass.id, meta: { blacklistId: hit.id, gateId: gate.id, scanId } });
        await notify({
          type: "blacklist_hit",
          userIds: await securityRecipientIds(site.id),
          siteId: site.id,
          payload: { passId: pass.id, visitorName: pass.visitorName, company: pass.company?.name ?? null, gateName: gate.name, blacklistId: hit.id },
          url: "/guard",
        });
      }
      log.info("guard.scan_denied", { reason: decision.reason, passId: pass?.id ?? null, deviceId: device.id });
      return Response.json({ ok: false, reason: decision.reason, ...(info ? { pass: info } : {}) } satisfies ScanResponse);
    }

    if (decision.action === "checkout" && pass && openVisit) {
      const visit = await checkoutVisit(openVisit.id, site.id, user.id, now);
      return Response.json({ ok: true, action: "left", visit: visitJson(visit), pass: info! } satisfies ScanResponse);
    }

    if (!pass || !info) return Response.json({ ok: false, reason: "not_found" } satisfies ScanResponse);

    let conflict = decision.action === "enter" && decision.conflict;
    if (!conflict) {
      const consumed = await consumePassUse(pass.id, site.id);
      if (!consumed) {
        if (!offline) return Response.json({ ok: false, reason: "no_uses_left", pass: info } satisfies ScanResponse);
        conflict = true; // consumed by another scan while this one was queued: track the visitor, flag the conflict
      }
    }

    const status = entryStatus(pass.kind);
    let visit;
    try {
      visit = await db.visit.create({
        data: {
          siteId: site.id,
          gateId: gate.id,
          passId: pass.id,
          hostEmployeeId: pass.hostEmployeeId,
          companyId: pass.companyId,
          visitorName: pass.visitorName,
          docHash: pass.visitorDocHash,
          docLast4: pass.visitorDocLast4,
          plate: pass.plate,
          kind: pass.kind,
          status,
          requestedById: user.id,
          decidedAt: now,
          decidedById: user.id,
          enteredAt: at,
          areaIds: pass.areaIds,
          escortEmployeeId: pass.escortEmployeeId,
          scanId,
          conflict,
        },
        select: visitSummarySelect,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const dup = await db.visit.findUnique({ where: { scanId }, select: visitSummarySelect });
        if (dup) return Response.json({ ok: true, action: "entered", duplicate: true, visit: visitJson(dup), pass: info } satisfies ScanResponse);
      }
      throw err;
    }
    await audit({ action: "visit.entered", siteId: site.id, actorId: user.id, targetType: "Visit", targetId: visit.id, meta: { passId: pass.id, gateId: gate.id, status, conflict, offline, scanId } });
    await notifyEntered(visit);
    log.info("guard.scan_entered", { visitId: visit.id, passId: pass.id, status, conflict });
    return Response.json({ ok: true, action: "entered", conflict, visit: visitJson(visit), pass: info } satisfies ScanResponse);
  });
}

async function loadPass(passId: string) {
  return db.pass.findUnique({
    where: { id: passId },
    include: { company: { select: { id: true, name: true, blocked: true } }, host: { select: { id: true, name: true, department: true } } },
  });
}

type LoadedPass = NonNullable<Awaited<ReturnType<typeof loadPass>>>;

async function passInfo(pass: LoadedPass, siteId: string): Promise<ScanPassInfo> {
  const areas = pass.areaIds.length ? await db.area.findMany({ where: { id: { in: pass.areaIds }, siteId }, select: { name: true, escortRequired: true, restricted: true } }) : [];
  const policy = policyFlags(pass.kind, await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind: pass.kind } } }));
  return {
    id: pass.id,
    kind: pass.kind,
    visitorName: pass.visitorName,
    company: pass.company?.name ?? null,
    host: pass.host.name,
    hostDepartment: pass.host.department,
    areas: areas.map((a) => a.name),
    warnings: passWarnings(policy, areas),
    docLast4: pass.visitorDocLast4,
    plate: pass.plate,
  };
}

function passInfoFromVisit(v: Prisma.VisitGetPayload<{ select: typeof visitSummarySelect }>): ScanPassInfo {
  return { id: v.passId ?? "", kind: v.kind, visitorName: v.visitorName, company: v.company?.name ?? null, host: v.host?.name ?? null, hostDepartment: v.host?.department ?? null, areas: [], warnings: [], docLast4: v.docLast4, plate: v.plate };
}
