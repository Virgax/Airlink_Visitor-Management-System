/**
 * Report queries (visits, audit, shift log) and CSV builders.
 * Queries always take the tenant's `siteFilter`; a `siteId` filter from the browser is honoured only when it is one
 * of the tenant's sites. CSV builders are pure (unit-tested): UTF-8 BOM, `;` separator (Excel es-DO), CRLF, dates in
 * the site's time zone as `YYYY-MM-DD HH:mm`.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { REPORT_PAGE_SIZE, rangeToUtc, type ShiftLogFilters, type VisitFilters } from "@/lib/server/reports-filters";
import { normalizePlate } from "@/lib/crypto/docHash";
import { DEFAULT_TIME_ZONE, zonedStartOfDay, localParts } from "@/lib/time/tz";

/** The slice of `Tenant` the reports need (type-only, so tests can build one by hand). */
export type ReportTenant = {
  siteFilter: { siteId?: string | { in: string[] } };
  sites: { id: string; name: string; timezone: string }[];
};

/** Hard cap for CSV exports. */
export const EXPORT_MAX_ROWS = 10_000;

// ───────────────────────────── Visits ─────────────────────────────

const visitInclude = {
  site: { select: { id: true, name: true, timezone: true } },
  gate: { select: { id: true, name: true } },
  host: { select: { id: true, name: true, department: true } },
  company: { select: { id: true, name: true } },
  escort: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  pass: { select: { id: true, ndaVersion: true, ndaAcceptedAt: true, approvedAt: true, approvedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.VisitInclude;

export type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitInclude }>;

export type VisitsResult = {
  rows: VisitRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  byStatus: Partial<Record<VisitRow["status"], number>>;
};

/** Resolves which site ids a report covers: the requested one when allowed, else everything the tenant sees. */
export function scopeSites(filters: { siteId?: string }, tenant: ReportTenant): { siteId?: string | { in: string[] } } {
  if (filters.siteId && tenant.sites.some((s) => s.id === filters.siteId)) return { siteId: filters.siteId };
  return tenant.siteFilter;
}

/** Time zone used for the date range and CSV dates: the selected site's, else the tenant's first site. */
export function reportTimeZone(filters: { siteId?: string }, tenant: ReportTenant): string {
  const site = (filters.siteId && tenant.sites.find((s) => s.id === filters.siteId)) || tenant.sites[0];
  return site?.timezone ?? DEFAULT_TIME_ZONE;
}

export function visitWhere(filters: VisitFilters, tenant: ReportTenant): Prisma.VisitWhereInput {
  const tz = reportTimeZone(filters, tenant);
  const range = rangeToUtc(filters, tz);
  const inRange = { gte: range.from, lt: range.to };
  return {
    ...scopeSites(filters, tenant),
    // A visit belongs to the day it entered; visits that never entered count on the day they were registered.
    OR: [{ enteredAt: inRange }, { enteredAt: null, createdAt: inRange }],
    ...(filters.gateId ? { gateId: filters.gateId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.host ? { host: { name: { contains: filters.host, mode: "insensitive" } } } : {}),
    ...(filters.areaId ? { areaIds: { has: filters.areaId } } : {}),
    ...(filters.company ? { company: { name: { contains: filters.company, mode: "insensitive" } } } : {}),
    ...(filters.q ? { AND: [freeTextWhere(filters.q)] } : {}),
  };
}

/** Free-text search: visitor name, company, host name, plate (normalized) and the last 4 digits of the document. */
export function freeTextWhere(q: string): Prisma.VisitWhereInput {
  const term = q.trim();
  const or: Prisma.VisitWhereInput[] = [
    { visitorName: { contains: term, mode: "insensitive" } },
    { company: { name: { contains: term, mode: "insensitive" } } },
    { host: { name: { contains: term, mode: "insensitive" } } },
  ];
  const plate = normalizePlate(term);
  if (plate.length >= 2) or.push({ plate: { contains: plate } });
  if (/^\d{4}$/.test(term)) or.push({ docLast4: term });
  return { OR: or };
}

const visitOrder: Prisma.VisitOrderByWithRelationInput[] = [{ enteredAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];

/** Paginated visits for the report table (`opts.all` returns up to EXPORT_MAX_ROWS rows for CSV). */
export async function queryVisits(filters: VisitFilters, tenant: ReportTenant, opts: { all?: boolean } = {}): Promise<VisitsResult> {
  const where = visitWhere(filters, tenant);
  const pageSize = opts.all ? EXPORT_MAX_ROWS : (filters.pageSize ?? REPORT_PAGE_SIZE);
  const [total, grouped] = await Promise.all([
    db.visit.count({ where }),
    db.visit.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = opts.all ? 1 : Math.min(filters.page, pages);
  const rows = await db.visit.findMany({ where, include: visitInclude, orderBy: visitOrder, skip: (page - 1) * pageSize, take: pageSize });
  const byStatus: VisitsResult["byStatus"] = {};
  for (const g of grouped) byStatus[g.status] = g._count._all;
  return { rows, total, page, pageSize, pages, byStatus };
}

// ───────────────────────────── Audit report ─────────────────────────────

export type AuditRow = VisitRow & { areaNames: string[]; blacklistHits: number };

/** Visits enriched for the audit report: area names and blacklist hits recorded in AuditLog. */
export async function queryAuditVisits(filters: VisitFilters, tenant: ReportTenant, opts: { all?: boolean } = {}): Promise<Omit<VisitsResult, "rows"> & { rows: AuditRow[] }> {
  const res = await queryVisits(filters, tenant, opts);
  const areaIds = new Set(res.rows.flatMap((r) => r.areaIds));
  const visitIds = res.rows.map((r) => r.id);
  const passIds = res.rows.map((r) => r.passId).filter((id): id is string => !!id);
  const [areas, hits] = await Promise.all([
    areaIds.size ? db.area.findMany({ where: { id: { in: [...areaIds] } }, select: { id: true, name: true } }) : [],
    visitIds.length
      ? db.auditLog.findMany({
          where: {
            action: "blacklist.hit",
            OR: [
              { targetType: "Visit", targetId: { in: visitIds } },
              ...(passIds.length ? [{ targetType: "Pass", targetId: { in: passIds } }] : []),
            ],
          },
          select: { targetType: true, targetId: true },
        })
      : [],
  ]);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const hitsByVisit = new Map<string, number>();
  const hitsByPass = new Map<string, number>();
  for (const h of hits) {
    if (!h.targetId) continue;
    const m = h.targetType === "Pass" ? hitsByPass : hitsByVisit;
    m.set(h.targetId, (m.get(h.targetId) ?? 0) + 1);
  }
  const rows: AuditRow[] = res.rows.map((r) => ({
    ...r,
    areaNames: r.areaIds.map((id) => areaName.get(id) ?? id),
    blacklistHits: (hitsByVisit.get(r.id) ?? 0) + (r.passId ? (hitsByPass.get(r.passId) ?? 0) : 0),
  }));
  return { ...res, rows };
}

// ───────────────────────────── Shift log ─────────────────────────────

const shiftLogInclude = {
  site: { select: { id: true, name: true, timezone: true } },
  gate: { select: { id: true, name: true } },
  guard: { select: { id: true, name: true } },
} satisfies Prisma.ShiftLogInclude;

export type ShiftLogRow = Prisma.ShiftLogGetPayload<{ include: typeof shiftLogInclude }>;

export function shiftLogWhere(filters: ShiftLogFilters, tenant: ReportTenant): Prisma.ShiftLogWhereInput {
  const range = rangeToUtc(filters, reportTimeZone(filters, tenant));
  return {
    ...scopeSites(filters, tenant),
    at: { gte: range.from, lt: range.to },
    ...(filters.gateId ? { gateId: filters.gateId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.guard ? { guard: { name: { contains: filters.guard, mode: "insensitive" } } } : {}),
  };
}

export async function queryShiftLogs(filters: ShiftLogFilters, tenant: ReportTenant, opts: { all?: boolean } = {}) {
  const where = shiftLogWhere(filters, tenant);
  const pageSize = opts.all ? EXPORT_MAX_ROWS : (filters.pageSize ?? REPORT_PAGE_SIZE);
  const [total, grouped] = await Promise.all([db.shiftLog.count({ where }), db.shiftLog.groupBy({ by: ["kind"], where, _count: { _all: true } })]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = opts.all ? 1 : Math.min(filters.page, pages);
  const rows = await db.shiftLog.findMany({ where, include: shiftLogInclude, orderBy: { at: "desc" }, skip: (page - 1) * pageSize, take: pageSize });
  const byKind: Partial<Record<ShiftLogRow["kind"], number>> = {};
  for (const g of grouped) byKind[g.kind] = g._count._all;
  return { rows, total, page, pageSize, pages, byKind };
}

// ───────────────────────────── Dashboard ─────────────────────────────

export type ReportKpis = { insideNow: number; enteredInRange: number; leftInRange: number };

/** KPI tiles of the visits report: on site right now (site scope only), entries and exits inside the date range. */
export async function reportKpis(filters: VisitFilters, tenant: ReportTenant): Promise<ReportKpis> {
  const scope = scopeSites(filters, tenant);
  const range = rangeToUtc(filters, reportTimeZone(filters, tenant));
  const inRange = { gte: range.from, lt: range.to };
  const gate = filters.gateId ? { gateId: filters.gateId } : {};
  const [insideNow, enteredInRange, leftInRange] = await Promise.all([
    db.visit.count({ where: { ...scope, ...gate, status: { in: ["inside", "at_dock"] } } }),
    db.visit.count({ where: { ...scope, ...gate, enteredAt: inRange } }),
    db.visit.count({ where: { ...scope, ...gate, leftAt: inRange } }),
  ]);
  return { insideNow, enteredInRange, leftInRange };
}

export type SiteCounts = { insideNow: number; enteredToday: number; pendingApprovals: number; incidentsToday: number };

/** Today's counters for one site (today = local day in the site's time zone). */
export async function siteDashboardCounts(site: { id: string; timezone: string }, now = new Date()): Promise<SiteCounts> {
  const start = zonedStartOfDay(localParts(now, site.timezone).ymd, site.timezone);
  const [insideNow, enteredToday, pendingVisits, pendingPasses, incidentsToday] = await Promise.all([
    db.visit.count({ where: { siteId: site.id, status: { in: ["inside", "at_dock"] } } }),
    db.visit.count({ where: { siteId: site.id, enteredAt: { gte: start } } }),
    db.visit.count({ where: { siteId: site.id, status: "pending" } }),
    db.pass.count({ where: { siteId: site.id, status: "pending_approval" } }),
    db.shiftLog.count({ where: { siteId: site.id, kind: "incident", at: { gte: start } } }),
  ]);
  return { insideNow, enteredToday, pendingApprovals: pendingVisits + pendingPasses, incidentsToday };
}

// ───────────────────────────── CSV ─────────────────────────────

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "﻿";

/**
 * Quotes a cell when it holds the separator, a comma, quotes or line breaks; doubles inner quotes.
 * Cells that would be read as formulas by Excel (= + - @ or a leading tab/CR) are prefixed with an apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

/** `YYYY-MM-DD HH:mm` in the site's time zone (locale-independent, sorts and parses in Excel). */
export function csvDate(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${(p.hour ?? "00").padStart(2, "0").replace("24", "00")}:${p.minute}`;
}

/** Whole minutes between entry and exit, or null while the visit is open. */
export function durationMinutes(enteredAt: Date | null, leftAt: Date | null): number | null {
  if (!enteredAt || !leftAt) return null;
  return Math.max(0, Math.round((leftAt.getTime() - enteredAt.getTime()) / 60_000));
}

export function buildCsv(header: string[], lines: (string | number | null | undefined)[][]): string {
  return CSV_BOM + [csvLine(header), ...lines.map(csvLine)].join("\r\n") + "\r\n";
}

/** Column labels come from the UI messages (`reports.csv.*`) so the file is in the reader's language. */
export type VisitCsvLabels = Record<
  "date" | "visitor" | "docLast4" | "plate" | "company" | "host" | "kind" | "site" | "gate" | "status" | "enteredAt" | "leftAt" | "durationMin" | "badgeNo" | "escort",
  string
> & { kinds: Record<string, string>; statuses: Record<string, string> };

export function visitsToCsv(rows: VisitRow[], timeZone: string, labels: VisitCsvLabels): string {
  const header = [labels.date, labels.visitor, labels.docLast4, labels.plate, labels.company, labels.host, labels.kind, labels.site, labels.gate, labels.status, labels.enteredAt, labels.leftAt, labels.durationMin, labels.badgeNo, labels.escort];
  const lines = rows.map((r) => [
    csvDate(r.enteredAt ?? r.createdAt, timeZone),
    r.visitorName,
    r.docLast4,
    r.plate,
    r.company?.name,
    r.host?.name,
    labels.kinds[r.kind] ?? r.kind,
    r.site.name,
    r.gate.name,
    labels.statuses[r.status] ?? r.status,
    csvDate(r.enteredAt, timeZone),
    csvDate(r.leftAt, timeZone),
    durationMinutes(r.enteredAt, r.leftAt),
    r.badgeNo,
    r.escort?.name,
  ]);
  return buildCsv(header, lines);
}

export type AuditCsvLabels = VisitCsvLabels & Record<"areas" | "ndaVersion" | "ndaAcceptedAt" | "passApprovedBy" | "passApprovedAt" | "visitDecidedBy" | "visitDecidedAt" | "blacklistHits", string>;

export function auditToCsv(rows: AuditRow[], timeZone: string, labels: AuditCsvLabels): string {
  const header = [labels.date, labels.visitor, labels.docLast4, labels.company, labels.host, labels.kind, labels.site, labels.gate, labels.status, labels.enteredAt, labels.leftAt, labels.areas, labels.escort, labels.ndaVersion, labels.ndaAcceptedAt, labels.passApprovedBy, labels.passApprovedAt, labels.visitDecidedBy, labels.visitDecidedAt, labels.blacklistHits];
  const lines = rows.map((r) => [
    csvDate(r.enteredAt ?? r.createdAt, timeZone),
    r.visitorName,
    r.docLast4,
    r.company?.name,
    r.host?.name,
    labels.kinds[r.kind] ?? r.kind,
    r.site.name,
    r.gate.name,
    labels.statuses[r.status] ?? r.status,
    csvDate(r.enteredAt, timeZone),
    csvDate(r.leftAt, timeZone),
    r.areaNames.join(", "),
    r.escort?.name,
    r.pass?.ndaVersion,
    csvDate(r.pass?.ndaAcceptedAt, timeZone),
    r.pass?.approvedBy?.name,
    csvDate(r.pass?.approvedAt, timeZone),
    r.decidedBy?.name,
    csvDate(r.decidedAt, timeZone),
    r.blacklistHits,
  ]);
  return buildCsv(header, lines);
}

export type ShiftLogCsvLabels = Record<"at" | "site" | "gate" | "guard" | "kind" | "text" | "photo", string> & { kinds: Record<string, string> };

export function shiftLogsToCsv(rows: ShiftLogRow[], timeZone: string, labels: ShiftLogCsvLabels): string {
  const header = [labels.at, labels.site, labels.gate, labels.guard, labels.kind, labels.text, labels.photo];
  const lines = rows.map((r) => [csvDate(r.at, timeZone), r.site.name, r.gate.name, r.guard.name, labels.kinds[r.kind] ?? r.kind, r.text, r.photoKey ? `/api/media/${r.photoKey}` : ""]);
  return buildCsv(header, lines);
}
