import "server-only";
import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSecret } from "@/lib/secrets";
import { fmtDate } from "@/lib/format";
import { localParts, zonedStartOfDay, addDaysYmd } from "@/lib/time/tz";
import { badgeSeq, formatBadgeNo, gateCode } from "@/lib/badges/badgeNo";
import { readBadgeTemplate, readPrinter, type KioskBadgeConfig } from "@/lib/badges/config";
import { loadBadgePhoto } from "@/lib/badges/photo";
import { signVisitQr } from "@/lib/badges/visitQr";
import { renderBadgeZpl, type BadgeData, type BadgeTemplate } from "@/lib/badges/zpl";
import { passWarnings, policyFlags } from "@/lib/guard/decide";
import { mediaConfigured } from "@/lib/media/putFile";
import { VisitError } from "@/lib/server/visits";

const badgeVisitSelect = {
  id: true,
  siteId: true,
  gateId: true,
  visitorName: true,
  docLast4: true,
  kind: true,
  status: true,
  enteredAt: true,
  createdAt: true,
  badgeNo: true,
  badgePhotoKey: true,
  areaIds: true,
  company: { select: { name: true } },
  host: { select: { name: true, department: true } },
  gate: { select: { name: true } },
  site: { select: { slug: true, timezone: true, settings: true } },
} satisfies Prisma.VisitSelect;

type BadgeVisit = Prisma.VisitGetPayload<{ select: typeof badgeVisitSelect }>;

/**
 * Assigns `<gate code>-<NNNN>` to a visit, numbering per site and local day (site time zone), unless it already has
 * one. Atomic: a transaction-scoped advisory lock on (site, day) serializes concurrent kiosks, and the update only
 * applies while `badgeNo` is still null, so two callers always end up with the same number.
 */
export async function assignBadgeNo(visitId: string): Promise<string> {
  const visit = await db.visit.findUnique({
    where: { id: visitId },
    select: { id: true, siteId: true, badgeNo: true, enteredAt: true, createdAt: true, gate: { select: { name: true } }, site: { select: { slug: true, timezone: true } } },
  });
  if (!visit) throw new VisitError("not_found");
  if (visit.badgeNo) return visit.badgeNo;

  const at = visit.enteredAt ?? visit.createdAt;
  const ymd = localParts(at, visit.site.timezone).ymd;
  const dayStart = zonedStartOfDay(ymd, visit.site.timezone);
  const dayEnd = zonedStartOfDay(addDaysYmd(ymd, 1), visit.site.timezone);
  const code = gateCode(visit.site.slug, visit.gate.name);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`badgeNo:${visit.siteId}:${ymd}`}))`;
    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(NULLIF(regexp_replace("badgeNo", '^.*-', ''), '')::int) AS max
      FROM "Visit"
      WHERE "siteId" = ${visit.siteId}
        AND "badgeNo" ~ '-[0-9]+$'
        AND COALESCE("enteredAt", "createdAt") >= ${dayStart}
        AND COALESCE("enteredAt", "createdAt") < ${dayEnd}`;
    const next = (rows[0]?.max ?? 0) + 1;
    const badgeNo = formatBadgeNo(code, next);
    const res = await tx.visit.updateMany({ where: { id: visit.id, badgeNo: null }, data: { badgeNo } });
    if (res.count === 1) return badgeNo;
    const again = await tx.visit.findUniqueOrThrow({ where: { id: visit.id }, select: { badgeNo: true } });
    return again.badgeNo ?? badgeNo;
  });
}

export { badgeSeq };

/** Site/gate badge configuration for a kiosk (template, printer, whether the photo step is available). */
export function kioskBadgeConfig(site: { settings: unknown }, gate: { settings?: unknown }): KioskBadgeConfig {
  const template = readBadgeTemplate(site.settings);
  return { template, printer: readPrinter(gate.settings), photoEnabled: template === "landscape_photo" && mediaConfigured() };
}

export type LoadedBadge = { visit: BadgeVisit; data: BadgeData; template: BadgeTemplate };

/**
 * Everything needed to print or preview the badge of a visit of `siteId`: assigns the badge number on first use,
 * translates kind/warnings/labels into `locale`, formats the entry time in the site zone and signs the visit QR.
 * With `withPhoto` the stored photo (if any) is decoded into the `^GFA` bitmap.
 */
export async function loadBadge(visitId: string, siteId: string, locale: string, opts: { withPhoto?: boolean } = {}): Promise<LoadedBadge> {
  const visit = await db.visit.findFirst({ where: { id: visitId, siteId }, select: badgeVisitSelect });
  if (!visit) throw new VisitError("not_found");
  if (visit.status !== "inside" && visit.status !== "at_dock" && visit.status !== "left") throw new VisitError("bad_state");
  const badgeNo = visit.badgeNo ?? (await assignBadgeNo(visit.id));

  const [t, tk, tw, policy, areas] = await Promise.all([
    getTranslations({ locale, namespace: "badges.label" }),
    getTranslations({ locale, namespace: "guard.kinds" }),
    getTranslations({ locale, namespace: "badges.warnings" }),
    db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind: visit.kind } } }),
    visit.areaIds.length ? db.area.findMany({ where: { id: { in: visit.areaIds }, siteId }, select: { name: true, escortRequired: true, restricted: true } }) : Promise.resolve([]),
  ]);
  const warnings = passWarnings(policyFlags(visit.kind, policy), areas)
    .filter((w) => w !== "noBadge")
    .map((w) => tw(w));
  const template = readBadgeTemplate(visit.site.settings);
  const photo = opts.withPhoto && template === "landscape_photo" ? await loadBadgePhoto(visit.badgePhotoKey) : null;

  const data: BadgeData = {
    visitorName: visit.visitorName,
    company: visit.company?.name ?? null,
    hostName: visit.host ? [visit.host.name, visit.host.department].filter(Boolean).join(" · ") : null,
    areaNames: areas.map((a) => a.name),
    kindLabel: tk(visit.kind),
    enteredAt: fmtDate(visit.enteredAt ?? visit.createdAt, locale, { timeZone: visit.site.timezone, dateStyle: "medium", timeStyle: "short" }),
    gateName: visit.gate.name,
    badgeNo,
    warnings,
    qrPayload: signVisitQr({ visitId: visit.id, siteId }, await getSecret("PASS_SIGNING_KEY")),
    docLast4: visit.docLast4,
    photo,
    labels: { host: t("host"), entry: t("entry"), badge: t("badge"), doc: t("doc") },
  };
  return { visit: { ...visit, badgeNo }, data, template };
}

/** ZPL for the badge of a visit (photo included when stored). */
export async function renderVisitBadge(visitId: string, siteId: string, locale: string): Promise<{ zpl: string; badge: LoadedBadge }> {
  const badge = await loadBadge(visitId, siteId, locale, { withPhoto: true });
  return { zpl: renderBadgeZpl(badge.data, badge.template), badge };
}

/** Audits a print; a reprint (anything after the first) is its own action so it stands out in the log. */
export async function auditBadgePrint(input: { visit: { id: string; siteId: string; gateId: string; badgeNo: string | null }; actorId: string; reprint: boolean; via: "agent" | "browser" | "download" | "zpl" }): Promise<void> {
  await audit({
    action: input.reprint ? "badge.reprinted" : "badge.printed",
    siteId: input.visit.siteId,
    actorId: input.actorId,
    targetType: "Visit",
    targetId: input.visit.id,
    meta: { badgeNo: input.visit.badgeNo, gateId: input.visit.gateId, via: input.via },
  });
}

/** JSON-safe badge data for the kiosk preview (no bitmap: the kiosk draws its own capture or loads the stored PNG). */
export function badgeJson(badge: LoadedBadge) {
  const { photo: _photo, ...data } = badge.data;
  return {
    visitId: badge.visit.id,
    status: badge.visit.status,
    template: badge.template,
    hasPhoto: Boolean(badge.visit.badgePhotoKey),
    photoKey: badge.visit.badgePhotoKey,
    data,
  };
}

export type BadgeJson = ReturnType<typeof badgeJson>;
