import { getLocale, getTranslations } from "next-intl/server";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { fmtDate, fmtNumber } from "@/lib/format";
import { durationMinutes, queryVisits, reportTimeZone } from "@/lib/server/reports";
import { filtersToQuery, parseVisitFilters, VISIT_KINDS, VISIT_STATUSES, type SearchParams } from "@/lib/server/reports-filters";
import { filterOptions, rawSiteId } from "./data";
import { FilterActions, Pagination, RangeSiteGateFields, ReportNav, StatusBadge } from "./ui";

export default async function VisitsReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/reports");
  const t = await getTranslations("reports");
  const locale = await getLocale();
  const filters = parseVisitFilters(sp, { timeZone: reportTimeZone({ siteId: rawSiteId(sp) }, tenant) });
  const tz = reportTimeZone(filters, tenant);
  const [result, options] = await Promise.all([queryVisits(filters, tenant), filterOptions(tenant)]);
  const showSite = tenant.sites.length > 1;
  const areas = filters.siteId ? options.areas.filter((a) => a.siteId === filters.siteId) : options.areas;
  const exportHref = `/admin/reports/export.csv${filtersToQuery({ ...filters, page: undefined })}`;
  const totals = [
    ["inside", (result.byStatus.inside ?? 0) + (result.byStatus.at_dock ?? 0)],
    ["left", result.byStatus.left ?? 0],
    ["pending", result.byStatus.pending ?? 0],
    ["denied", (result.byStatus.denied ?? 0) + (result.byStatus.timeout ?? 0)],
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro.visits")}</p>
      </div>
      <ReportNav active="visits" />

      <form method="get" action="/admin/reports" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RangeSiteGateFields filters={filters} sites={tenant.sites} gates={options.gates} showSite={showSite} />
        <div>
          <label className="label" htmlFor="kind">{t("filters.kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={filters.kind ?? ""}>
            <option value="">{t("filters.all")}</option>
            {VISIT_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">{t("filters.status")}</label>
          <select id="status" name="status" className="input" defaultValue={filters.status ?? ""}>
            <option value="">{t("filters.all")}</option>
            {VISIT_STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
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
        <FilterActions clearHref="/admin/reports" exportHref={exportHref} />
      </form>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="visit-totals">
        <div className="card">
          <dt className="muted">{t("nav.visits")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid="visit-total">{fmtNumber(result.total, locale)}</dd>
        </div>
        {totals.map(([k, v]) => (
          <div key={k} className="card">
            <dt className="muted">{t(`totals.${k}`)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(v, locale)}</dd>
          </div>
        ))}
      </dl>

      <p className="muted">{t("totals.visits", { count: result.total })} · {t("filters.timeZone", { tz })}</p>

      {result.rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="visits-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("columns.date")}</th>
                <th className="px-3 py-2">{t("columns.visitor")}</th>
                <th className="px-3 py-2">{t("columns.company")}</th>
                <th className="px-3 py-2">{t("columns.host")}</th>
                <th className="px-3 py-2">{t("columns.kind")}</th>
                {showSite ? <th className="px-3 py-2">{t("columns.site")}</th> : null}
                <th className="px-3 py-2">{t("columns.gate")}</th>
                <th className="px-3 py-2">{t("columns.status")}</th>
                <th className="px-3 py-2">{t("columns.enteredAt")}</th>
                <th className="px-3 py-2">{t("columns.leftAt")}</th>
                <th className="px-3 py-2 text-right">{t("columns.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => {
                const dur = durationMinutes(r.enteredAt, r.leftAt);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.enteredAt ?? r.createdAt, locale, { timeZone: r.site.timezone, dateStyle: "short", timeStyle: undefined })}</td>
                    <td className="px-3 py-2 font-medium">{r.visitorName}{r.docLast4 ? <span className="muted"> · {r.docLast4}</span> : null}</td>
                    <td className="px-3 py-2">{r.company?.name ?? t("none")}</td>
                    <td className="px-3 py-2">{r.host?.name ?? t("none")}</td>
                    <td className="px-3 py-2">{t(`kinds.${r.kind}`)}</td>
                    {showSite ? <td className="px-3 py-2">{r.site.name}</td> : null}
                    <td className="px-3 py-2">{r.gate.name}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} label={t(`statuses.${r.status}`)} /></td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.enteredAt ? fmtDate(r.enteredAt, locale, { timeZone: r.site.timezone, dateStyle: undefined, timeStyle: "short" }) : t("none")}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.leftAt ? fmtDate(r.leftAt, locale, { timeZone: r.site.timezone, dateStyle: undefined, timeStyle: "short" }) : t("none")}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{dur !== null ? t("minutes", { count: fmtNumber(dur, locale) }) : r.enteredAt ? t("open") : t("none")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination basePath="/admin/reports" filters={filters} page={result.page} pages={result.pages} />
    </div>
  );
}
