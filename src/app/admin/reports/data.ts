import "server-only";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import type { Tenant } from "@/lib/auth/guards";
import type { AuditCsvLabels, ShiftLogCsvLabels, VisitCsvLabels } from "@/lib/server/reports";
import { SHIFT_LOG_KINDS, VISIT_KINDS, VISIT_STATUSES, type SearchParams } from "@/lib/server/reports-filters";

/** Gates and areas of the tenant's sites, for the filter selects. */
export async function filterOptions(tenant: Tenant) {
  const siteIds = tenant.sites.map((s) => s.id);
  const [gates, areas] = await Promise.all([
    db.gate.findMany({ where: { siteId: { in: siteIds }, active: true }, select: { id: true, name: true, siteId: true, site: { select: { name: true } } }, orderBy: [{ site: { name: "asc" } }, { name: "asc" }] }),
    db.area.findMany({ where: { siteId: { in: siteIds }, active: true }, select: { id: true, name: true, siteId: true, site: { select: { name: true } } }, orderBy: [{ site: { name: "asc" } }, { name: "asc" }] }),
  ]);
  return {
    gates: gates.map((g) => ({ id: g.id, name: g.name, siteId: g.siteId, siteName: g.site.name })),
    areas: areas.map((a) => ({ id: a.id, name: a.name, siteId: a.siteId, siteName: a.site.name })),
  };
}

/** The raw `siteId` from the URL, used only to pick the time zone before the filters are parsed. */
export function rawSiteId(sp: SearchParams): string | undefined {
  return typeof sp.siteId === "string" && sp.siteId ? sp.siteId : undefined;
}

type T = Awaited<ReturnType<typeof getTranslations<"reports">>>;

function enumLabels(t: T, ns: "kinds" | "statuses" | "shiftKinds", keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, t(`${ns}.${k}` as Parameters<T>[0])]));
}

/** CSV column labels in the reader's language (`reports.csv.*`). */
export async function csvLabels(): Promise<{ visits: VisitCsvLabels; audit: AuditCsvLabels; shifts: ShiftLogCsvLabels }> {
  const t = await getTranslations("reports");
  const c = (k: string) => t(`csv.${k}` as Parameters<T>[0]);
  const kinds = enumLabels(t, "kinds", VISIT_KINDS);
  const statuses = enumLabels(t, "statuses", VISIT_STATUSES);
  const visits: VisitCsvLabels = {
    date: c("date"), visitor: c("visitor"), docLast4: c("docLast4"), plate: c("plate"), company: c("company"), host: c("host"), kind: c("kind"), site: c("site"), gate: c("gate"),
    status: c("status"), enteredAt: c("enteredAt"), leftAt: c("leftAt"), durationMin: c("durationMin"), badgeNo: c("badgeNo"), escort: c("escort"), kinds, statuses,
  };
  const audit: AuditCsvLabels = {
    ...visits, areas: c("areas"), ndaVersion: c("ndaVersion"), ndaAcceptedAt: c("ndaAcceptedAt"), passApprovedBy: c("passApprovedBy"), passApprovedAt: c("passApprovedAt"),
    visitDecidedBy: c("visitDecidedBy"), visitDecidedAt: c("visitDecidedAt"), blacklistHits: c("blacklistHits"),
  };
  const shifts: ShiftLogCsvLabels = { at: c("at"), site: c("site"), gate: c("gate"), guard: c("guard"), kind: c("kind"), text: c("text"), photo: c("photo"), kinds: enumLabels(t, "shiftKinds", SHIFT_LOG_KINDS) };
  return { visits, audit, shifts };
}

/** Response for a CSV download. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
