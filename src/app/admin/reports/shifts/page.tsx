import { getLocale, getTranslations } from "next-intl/server";
import { Camera } from "lucide-react";
import { Icon } from "@/components/Icon";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { fmtDate, fmtNumber } from "@/lib/format";
import { queryShiftLogs, reportTimeZone } from "@/lib/server/reports";
import { filtersToQuery, parseShiftLogFilters, SHIFT_LOG_KINDS, type SearchParams } from "@/lib/server/reports-filters";
import { filterOptions, rawSiteId } from "../data";
import { FilterActions, Pagination, RangeSiteGateFields, ReportNav } from "../ui";

export default async function ShiftsReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/reports/shifts");
  const t = await getTranslations("reports");
  const locale = await getLocale();
  const filters = parseShiftLogFilters(sp, { timeZone: reportTimeZone({ siteId: rawSiteId(sp) }, tenant) });
  const tz = reportTimeZone(filters, tenant);
  const [result, options] = await Promise.all([queryShiftLogs(filters, tenant), filterOptions(tenant)]);
  const showSite = tenant.sites.length > 1;
  const exportHref = `/admin/reports/shifts/export.csv${filtersToQuery({ ...filters, page: undefined })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro.shifts")}</p>
      </div>
      <ReportNav active="shifts" />

      <form method="get" action="/admin/reports/shifts" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RangeSiteGateFields filters={filters} sites={tenant.sites} gates={options.gates} showSite={showSite} />
        <div>
          <label className="label" htmlFor="kind">{t("filters.kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={filters.kind ?? ""}>
            <option value="">{t("filters.all")}</option>
            {SHIFT_LOG_KINDS.map((k) => <option key={k} value={k}>{t(`shiftKinds.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="guard">{t("filters.guard")}</label>
          <input id="guard" name="guard" type="search" className="input" defaultValue={filters.guard ?? ""} placeholder={t("filters.guardPlaceholder")} maxLength={80} />
        </div>
        <FilterActions clearHref="/admin/reports/shifts" exportHref={exportHref} />
      </form>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="shift-totals">
        <div className="card">
          <dt className="muted">{t("nav.shifts")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(result.total, locale)}</dd>
        </div>
        {SHIFT_LOG_KINDS.map((k) => (
          <div key={k} className="card">
            <dt className="muted">{t(`shiftKinds.${k}`)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(result.byKind[k] ?? 0, locale)}</dd>
          </div>
        ))}
      </dl>

      <p className="muted">{t("totals.entries", { count: result.total })} · {t("filters.timeZone", { tz })}</p>

      {result.rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="shifts-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("columns.at")}</th>
                {showSite ? <th className="px-3 py-2">{t("columns.site")}</th> : null}
                <th className="px-3 py-2">{t("columns.gate")}</th>
                <th className="px-3 py-2">{t("columns.guard")}</th>
                <th className="px-3 py-2">{t("columns.kind")}</th>
                <th className="px-3 py-2">{t("columns.text")}</th>
                <th className="px-3 py-2">{t("columns.photo")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.at, locale, { timeZone: r.site.timezone, dateStyle: "short", timeStyle: "short" })}</td>
                  {showSite ? <td className="px-3 py-2">{r.site.name}</td> : null}
                  <td className="px-3 py-2">{r.gate.name}</td>
                  <td className="px-3 py-2">{r.guard.name}</td>
                  <td className="px-3 py-2">{r.kind === "incident" ? <span className="font-semibold text-danger">{t(`shiftKinds.${r.kind}`)}</span> : t(`shiftKinds.${r.kind}`)}</td>
                  <td className="max-w-md whitespace-pre-wrap break-words px-3 py-2">{r.text}</td>
                  <td className="px-3 py-2">
                    {r.photoKey ? <a href={`/api/media/${r.photoKey}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><Icon icon={Camera} size={16} /> {t("viewPhoto")}</a> : t("none")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination basePath="/admin/reports/shifts" filters={filters} page={result.page} pages={result.pages} />
    </div>
  );
}
