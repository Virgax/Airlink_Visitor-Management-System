import { db } from "@/lib/db";
import { kioskRoute } from "@/lib/guard/route";
import { touchDevice } from "@/lib/auth/kiosk";
import { passWarnings, policyFlags } from "@/lib/guard/decide";
import type { PassCache } from "@/lib/offline/provisional";

export const dynamic = "force-dynamic";

/**
 * Short-lived offline cache for the kiosk: today's valid passes of this site (no signatures, no documents) so a scan
 * can show a provisional result without network. Refreshed by the kiosk every 5 minutes.
 */
export async function GET(): Promise<Response> {
  return kioskRoute(async ({ site, device }) => {
    await touchDevice(device.id);
    const now = new Date();
    const horizon = new Date(now.getTime() + 24 * 3_600_000);
    const [passes, policies, areas, blacklistCount] = await Promise.all([
      db.pass.findMany({
        where: { siteId: site.id, status: "active", validFrom: { lte: horizon }, validUntil: { gte: now } },
        select: { id: true, kind: true, visitorName: true, validFrom: true, validUntil: true, maxUses: true, uses: true, areaIds: true, company: { select: { name: true } }, host: { select: { name: true } } },
        orderBy: { validFrom: "asc" },
        take: 2000,
      }),
      db.visitPolicy.findMany({ where: { siteId: site.id } }),
      db.area.findMany({ where: { siteId: site.id }, select: { id: true, name: true, escortRequired: true, restricted: true } }),
      db.blacklist.count({ where: { OR: [{ siteId: site.id }, { siteId: null }], AND: { OR: [{ until: null }, { until: { gt: now } }] } } }),
    ]);
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const body: PassCache = {
      generatedAt: now.toISOString(),
      blacklistCount,
      passes: passes.map((p) => {
        const passAreas = p.areaIds.map((id) => areaById.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
        const policy = policyFlags(p.kind, policies.find((row) => row.kind === p.kind));
        return {
          id: p.id,
          kind: p.kind,
          visitorName: p.visitorName,
          company: p.company?.name ?? null,
          host: p.host.name,
          validFrom: p.validFrom.toISOString(),
          validUntil: p.validUntil.toISOString(),
          maxUses: p.maxUses,
          uses: p.uses,
          warnings: passWarnings(policy, passAreas),
          areas: passAreas.map((a) => a.name),
        };
      }),
    };
    return Response.json(body, { headers: { "cache-control": "private, no-store" } });
  });
}
