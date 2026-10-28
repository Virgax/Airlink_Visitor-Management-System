import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications/index";
import type { KioskContext } from "@/lib/auth/kiosk";
import { entryStatus, matchBlacklist, passWarnings, policyFlags, type BlacklistRow } from "@/lib/guard/decide";
import type { ScanPassInfo, ScanResponse } from "@/lib/guard/types";
import { consumePassUse } from "@/lib/server/passes";
import { notifyEntered, securityRecipientIds, visitJson, visitSummarySelect } from "@/lib/server/visits";
import { log } from "@/lib/log";

/**
 * Kiosk entry shared by the QR scan (`/api/guard/scan`) and the PIN entry (`/api/guard/pin`): loading a pass with
 * what the green screen shows, the blacklist lookup, and `enterWithPass`, which consumes a use and creates the Visit.
 * The decision itself (deny / checkout / enter) stays in the routes; the QR route keeps `decideScan` untouched.
 */

export async function loadPass(passId: string) {
  return db.pass.findUnique({
    where: { id: passId },
    include: { company: { select: { id: true, name: true, blocked: true } }, host: { select: { id: true, name: true, department: true } } },
  });
}

export type LoadedPass = NonNullable<Awaited<ReturnType<typeof loadPass>>>;

export async function passInfo(pass: LoadedPass, siteId: string): Promise<ScanPassInfo> {
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

export function passInfoFromVisit(v: Prisma.VisitGetPayload<{ select: typeof visitSummarySelect }>): ScanPassInfo {
  return { id: v.passId ?? "", kind: v.kind, visitorName: v.visitorName, company: v.company?.name ?? null, host: v.host?.name ?? null, hostDepartment: v.host?.department ?? null, areas: [], warnings: [], docLast4: v.docLast4, plate: v.plate };
}

/** First blacklist row (site or global) matching the pass's document or plate, or null. */
export async function findBlacklistHit(pass: Pick<LoadedPass, "visitorDocHash" | "plate">, siteId: string, now: Date): Promise<BlacklistRow | null> {
  if (!pass.visitorDocHash && !pass.plate) return null;
  const rows = await db.blacklist.findMany({
    where: { OR: [{ siteId }, { siteId: null }], AND: { OR: [...(pass.visitorDocHash ? [{ docHash: pass.visitorDocHash }] : []), ...(pass.plate ? [{ plate: pass.plate }] : [])] } },
    select: { id: true, siteId: true, docHash: true, plate: true, until: true },
  });
  return matchBlacklist(rows, { docHash: pass.visitorDocHash, plate: pass.plate }, siteId, now);
}

/** The open visit (inside / at_dock) of a pass at this site, newest first. */
export async function findOpenVisit(passId: string, siteId: string): Promise<{ id: string } | null> {
  return db.visit.findFirst({ where: { passId, siteId, status: { in: ["inside", "at_dock"] } }, select: { id: true }, orderBy: { enteredAt: "desc" } });
}

/** Audits the blacklist hit and alerts security; the caller then answers `blacklisted`. */
export async function reportBlacklistHit(pass: LoadedPass, hit: BlacklistRow, kiosk: KioskContext, meta: Record<string, string | boolean | null>): Promise<void> {
  const { user, site, gate } = kiosk;
  await audit({ action: "blacklist.hit", siteId: site.id, actorId: user.id, targetType: "Pass", targetId: pass.id, meta: { blacklistId: hit.id, gateId: gate.id, ...meta } });
  await notify({
    type: "blacklist_hit",
    userIds: await securityRecipientIds(site.id),
    siteId: site.id,
    payload: { passId: pass.id, visitorName: pass.visitorName, company: pass.company?.name ?? null, gateName: gate.name, blacklistId: hit.id },
    url: "/guard",
  });
}

export type EnterInput = {
  pass: LoadedPass;
  info: ScanPassInfo;
  kiosk: KioskContext;
  /** Client (or server) generated id; the server dedupes on it. */
  scanId: string;
  /** Instant the entry is recorded at (the client's `at` for queued scans). */
  at: Date;
  now: Date;
  /** The decision already flagged a conflict (queued scan whose pass was consumed meanwhile). */
  conflict: boolean;
  offline: boolean;
  /** How the visitor identified: kept in the audit entry. */
  via: "qr" | "pin";
};

/**
 * Consumes one use of the pass and creates the Visit (inside, or at_dock for carriers). Returns the kiosk JSON
 * answer: `no_uses_left` when nothing was left (online), a conflict-flagged entry when offline, and a `duplicate`
 * answer when the same scanId was already recorded. Audits `visit.entered` and notifies the host.
 */
export async function enterWithPass(input: EnterInput): Promise<ScanResponse> {
  const { pass, info, scanId, at, now, offline, via } = input;
  const { user, site, gate } = input.kiosk;
  let conflict = input.conflict;
  if (!conflict) {
    const consumed = await consumePassUse(pass.id, site.id);
    if (!consumed) {
      if (!offline) return { ok: false, reason: "no_uses_left", pass: info };
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
      if (dup && dup.siteId === site.id) return { ok: true, action: "entered", duplicate: true, visit: visitJson(dup), pass: info };
    }
    throw err;
  }
  await audit({ action: "visit.entered", siteId: site.id, actorId: user.id, targetType: "Visit", targetId: visit.id, meta: { passId: pass.id, gateId: gate.id, status, conflict, offline, scanId, ...(via === "pin" ? { via } : {}) } });
  await notifyEntered(visit);
  log.info("guard.scan_entered", { visitId: visit.id, passId: pass.id, status, conflict, via });
  return { ok: true, action: "entered", conflict, visit: visitJson(visit), pass: info };
}
