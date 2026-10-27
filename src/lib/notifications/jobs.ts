import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";

const DEFAULT_UNANNOUNCED_TIMEOUT_MIN = 5;

function settingNumber(settings: unknown, key: string, fallback: number): number {
  if (settings && typeof settings === "object") {
    const v = (settings as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
}

/** Active users with a security membership for the site (or for every site). */
async function securityUserIds(siteId: string): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { role: "security", status: "active", OR: [{ siteId }, { siteId: null }], user: { status: "active" } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Cron: unannounced visits still `pending` after `settings.unannouncedTimeoutMin` (default 5) become `timeout`,
 * and security staff of the site are re-notified (`visit_at_gate` with `escalated: true`) so they can call the
 * host's extension or a substitute. Returns the number of visits timed out.
 */
export async function timeoutPendingVisits(now = new Date()): Promise<number> {
  const sites = await db.site.findMany({ where: { active: true }, select: { id: true, name: true, settings: true } });
  let total = 0;
  for (const site of sites) {
    const minutes = settingNumber(site.settings, "unannouncedTimeoutMin", DEFAULT_UNANNOUNCED_TIMEOUT_MIN);
    const cutoff = new Date(now.getTime() - minutes * 60_000);
    const stale = await db.visit.findMany({
      where: { siteId: site.id, status: "pending", createdAt: { lt: cutoff } },
      select: { id: true, visitorName: true, gate: { select: { name: true } }, host: { select: { name: true, extension: true } }, company: { select: { name: true } } },
      take: 200,
    });
    if (stale.length === 0) continue;
    const security = await securityUserIds(site.id);
    for (const visit of stale) {
      const res = await db.visit.updateMany({ where: { id: visit.id, status: "pending" }, data: { status: "timeout", decidedAt: now } });
      if (res.count === 0) continue; // decided meanwhile
      total += 1;
      await notify({
        type: "visit_at_gate",
        userIds: security,
        siteId: site.id,
        payload: {
          visitId: visit.id,
          visitorName: visit.visitorName,
          company: visit.company?.name ?? "",
          gateName: visit.gate.name,
          hostName: visit.host?.name ?? "",
          hostExtension: visit.host?.extension ?? "",
          siteName: site.name,
          escalated: true,
        },
        url: "/app/notifications",
      });
    }
  }
  if (total) log.info("visits.timed_out", { count: total });
  return total;
}

/**
 * Cron: visits `inside` for longer than the policy's `maxDurationMin` raise `visitor_overstay` to the host and
 * security, once per visit. The stored `visitor_overstay` notification whose payload carries the visitId is the
 * marker that prevents repeats. Returns the number of visits alerted.
 */
export async function alertOverstays(now = new Date()): Promise<number> {
  const policies = await db.visitPolicy.findMany({
    where: { maxDurationMin: { not: null }, site: { active: true } },
    select: { siteId: true, kind: true, maxDurationMin: true, site: { select: { name: true } } },
  });
  let total = 0;
  const securityCache = new Map<string, string[]>();
  for (const policy of policies) {
    const maxMinutes = policy.maxDurationMin ?? 0;
    if (maxMinutes <= 0) continue;
    const cutoff = new Date(now.getTime() - maxMinutes * 60_000);
    const visits = await db.visit.findMany({
      where: { siteId: policy.siteId, kind: policy.kind, status: "inside", enteredAt: { lt: cutoff } },
      select: { id: true, visitorName: true, enteredAt: true, hostEmployeeId: true, gate: { select: { name: true } }, company: { select: { name: true } } },
      take: 200,
    });
    for (const visit of visits) {
      const already = await db.notification.findFirst({
        where: { type: "visitor_overstay", payload: { path: ["visitId"], equals: visit.id } },
        select: { id: true },
      });
      if (already) continue;
      let security = securityCache.get(policy.siteId);
      if (!security) {
        security = await securityUserIds(policy.siteId);
        securityCache.set(policy.siteId, security);
      }
      const minutes = visit.enteredAt ? Math.floor((now.getTime() - visit.enteredAt.getTime()) / 60_000) : maxMinutes;
      const res = await notify({
        type: "visitor_overstay",
        userIds: security,
        employeeIds: visit.hostEmployeeId ? [visit.hostEmployeeId] : [],
        siteId: policy.siteId,
        payload: {
          visitId: visit.id,
          visitorName: visit.visitorName,
          company: visit.company?.name ?? "",
          gateName: visit.gate.name,
          siteName: policy.site.name,
          minutes,
          maxMinutes,
        },
        url: "/guard",
      });
      if (res.stored === 0) log.warn("overstay.no_recipients", { visitId: visit.id, siteId: policy.siteId });
      total += 1;
    }
  }
  if (total) log.info("visits.overstay", { count: total });
  return total;
}
