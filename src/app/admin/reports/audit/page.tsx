import { getLocale, getTranslations } from "next-intl/server";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { fmtDate, fmtNumber } from "@/lib/format";
import { queryAuditVisits, reportTimeZone } from "@/lib/server/reports";
import { filtersToQuery, parseVisitFilters, VISIT_KINDS, type SearchParams } from "@/lib/server/reports-filters";
import { filterOptions, rawSiteId } from "../data";
import { FilterActions, Pagination, RangeSiteGateFields, ReportNav, StatusBadge } from "../ui";

export default async function AuditReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/reports/audit");
  const t = await getTranslations("reports");
  const locale = await getLocale();
  const filters = parseVisitFilters(sp, { timeZone: reportTimeZone({ siteId: rawSiteId(sp) }, tenant) });
  const tz = reportTimeZone(filters, tenant);
  const [result, options] = await Promise.all([queryAuditVisits(filters, tenant), filterOptions(tenant)]);
  const showSite = tenant.sites.length > 1;
  const areas = filters.siteId ? options.areas.filter((a) => a.siteId === filters.siteId) : options.areas;
  const exportHref = `/admin/reports/audit/export.csv${filtersToQuery({ ...filters, page: undefined })}`;
  const short = (d: Date | null | undefined, zone: string) => (d ? fmtDate(d, locale, { timeZone: zone, dateStyle: "short", timeStyle: "short" }) : t("none"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro.audit")}</p>
      </div>
      <ReportNav active="audit" />

      <form method="get" action="/admin/reports/audit" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RangeSiteGateFields filters={filters} sites={tenant.sites} gates={options.gates} showSite={showSite} />
        <div>
          <label className="label" htmlFor="kind">{t("filters.kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={filters.kind ?? ""}>
            <option value="">{t("filters.all")}</option>
            {VISIT_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="host">{t("filters.host")}</label>
          <input id="host" name="host" type="search" className="input" defaultValue={filters.host ?? ""} placeholder={t("filters.hostPlaceholder")} maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="areaId">{t("filters.area")}</label>
          <select id="areaId" name="areaId" className="input" defaultValue={filters.areaId ?? ""}>
            <option value="">{t("filters.all")}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{showSite ? `${a.siteName} · ${a.name}` : a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="company">{t("filters.company")}</label>
          <input id="company" name="company" type="search" className="input" defaultValue={filters.company ?? ""} placeholder={t("filters.companyPlaceholder")} maxLength={80} />
        </div>
        <FilterActions clearHref="/admin/reports/audit" exportHref={exportHref} />
      </form>

      <p className="muted">{t("totals.visits", { count: result.total })} · {t("filters.timeZone", { tz })}</p>

      {result.rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("columns.date")}</th>
                <th className="px-3 py-2">{t("columns.visitor")}</th>
                <th className="px-3 py-2">{t("columns.host")}</th>
                <th className="px-3 py-2">{t("columns.kind")}</th>
                <th className="px-3 py-2">{t("columns.status")}</th>
                <th className="px-3 py-2">{t("columns.areas")}</th>
                <th className="px-3 py-2">{t("columns.escort")}</th>
                <th className="px-3 py-2">{t("columns.nda")}</th>
                <th className="px-3 py-2">{t("columns.passApproval")}</th>
                <th className="px-3 py-2">{t("columns.visitDecision")}</th>
                <th className="px-3 py-2 text-right">{t("columns.blacklistHits")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{short(r.enteredAt ?? r.createdAt, r.site.timezone)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.visitorName}{r.docLast4 ? <span className="muted"> · {r.docLast4}</span> : null}</p>
                    <p className="muted">{[r.company?.name, showSite ? r.site.name : null, r.gate.name].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2">{r.host?.name ?? t("none")}</td>
                  <td className="px-3 py-2">{t(`kinds.${r.kind}`)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} label={t(`statuses.${r.status}`)} /></td>
                  <td className="px-3 py-2">{r.areaNames.length ? r.areaNames.join(", ") : t("none")}</td>
                  <td className="px-3 py-2">{r.escort?.name ?? t("none")}</td>
                  <td className="px-3 py-2">{r.pass?.ndaVersion ? t("by", { name: r.pass.ndaVersion, date: short(r.pass.ndaAcceptedAt, r.site.timezone) }) : t("noNda")}</td>
                  <td className="px-3 py-2">{r.pass?.approvedBy ? t("by", { name: r.pass.approvedBy.name, date: short(r.pass.approvedAt, r.site.timezone) }) : t("none")}</td>
                  <td className="px-3 py-2">{r.decidedBy ? t("by", { name: r.decidedBy.name, date: short(r.decidedAt, r.site.timezone) }) : t("none")}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.blacklistHits ? "font-semibold text-danger" : ""}`}>{fmtNumber(r.blacklistHits, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination basePath="/admin/reports/audit" filters={filters} page={result.page} pages={result.pages} />
    </div>
  );
}
