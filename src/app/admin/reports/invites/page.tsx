import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { fmtDate, fmtNumber } from "@/lib/format";
import { PASS_STATUSES, parseInviteFilters, queryInvites } from "@/lib/server/invites";
import { reportTimeZone } from "@/lib/server/reports";
import { filtersToQuery, VISIT_KINDS, type SearchParams } from "@/lib/server/reports-filters";
import { PassStatusBadge } from "@/components/passes/PassStatusBadge";
import { rawSiteId } from "../data";
import { FilterActions, Pagination, ReportNav } from "../ui";

export const dynamic = "force-dynamic";

export default async function InvitesReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/reports/invites");
  const t = await getTranslations("people.invites");
  const tr = await getTranslations("reports");
  const tp = await getTranslations("passes");
  const th = await getTranslations("host");
  const locale = await getLocale();
  const filters = parseInviteFilters(sp, { timeZone: reportTimeZone({ siteId: rawSiteId(sp) }, tenant) });
  const tz = reportTimeZone(filters, tenant);
  const result = await queryInvites(filters, tenant);
  const showSite = tenant.sites.length > 1;
  const exportHref = `/admin/reports/invites/export.csv${filtersToQuery({ ...filters, page: undefined })}`;
  const pinCount = result.rows.filter((r) => r.pinHash).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tr("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      <ReportNav active="invites" />

      <form method="get" action="/admin/reports/invites" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="from">{tr("filters.from")}</label>
          <input id="from" name="from" type="date" className="input" defaultValue={filters.from} required />
        </div>
        <div>
          <label className="label" htmlFor="to">{tr("filters.to")}</label>
          <input id="to" name="to" type="date" className="input" defaultValue={filters.to} required />
        </div>
        {showSite ? (
          <div>
            <label className="label" htmlFor="siteId">{tr("filters.site")}</label>
            <select id="siteId" name="siteId" className="input" defaultValue={filters.siteId ?? ""}>
              <option value="">{tr("filters.all")}</option>
              {tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="q">{t("filters.q")}</label>
          <input id="q" name="q" type="search" className="input" defaultValue={filters.q ?? ""} placeholder={t("filters.qPlaceholder")} maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="kind">{t("filters.kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={filters.kind ?? ""}>
            <option value="">{t("filters.all")}</option>
            {VISIT_KINDS.map((k) => <option key={k} value={k}>{tr(`kinds.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">{t("filters.status")}</label>
          <select id="status" name="status" className="input" defaultValue={filters.status ?? ""}>
            <option value="">{t("filters.all")}</option>
            {PASS_STATUSES.map((s) => <option key={s} value={s}>{tp(`status.${s}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pin">{t("filters.pin")}</label>
          <select id="pin" name="pin" className="input" defaultValue={filters.pin ?? ""}>
            <option value="">{t("filters.all")}</option>
            <option value="yes">{t("filters.yes")}</option>
            <option value="no">{t("filters.no")}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="signedIn">{t("filters.signedIn")}</label>
          <select id="signedIn" name="signedIn" className="input" defaultValue={filters.signedIn ?? ""}>
            <option value="">{t("filters.all")}</option>
            <option value="yes">{t("filters.yes")}</option>
            <option value="no">{t("filters.no")}</option>
          </select>
        </div>
        <FilterActions clearHref="/admin/reports/invites" exportHref={exportHref} />
      </form>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="invite-totals">
        <div className="card">
          <dt className="muted">{t("totals.invites")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid="invite-total">{fmtNumber(result.total, locale)}</dd>
        </div>
        <div className="card">
          <dt className="muted">{t("totals.signedIn")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid="invite-signed-in">{fmtNumber(result.signedIn, locale)}</dd>
        </div>
        <div className="card">
          <dt className="muted">{t("totals.pin")}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(pinCount, locale)}</dd>
        </div>
      </dl>
      <p className="muted">{tr("filters.timeZone", { tz })}</p>

      {result.rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="invites-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("columns.date")}</th>
                <th className="px-3 py-2">{t("columns.visitor")}</th>
                <th className="px-3 py-2">{t("columns.host")}</th>
                <th className="px-3 py-2">{t("columns.kind")}</th>
                {showSite ? <th className="px-3 py-2">{t("columns.site")}</th> : null}
                <th className="px-3 py-2">{t("columns.pin")}</th>
                <th className="px-3 py-2">{t("columns.signedIn")}</th>
                <th className="px-3 py-2">{t("columns.status")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="invite-row">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.validFrom, locale, { timeZone: r.site.timezone, dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-3 py-2 font-medium">
                    {r.visitorName}
                    {r.company ? <span className="muted"> · {r.company.name}</span> : null}
                    {r.visitorEmail ? <span className="muted block">{r.visitorEmail}</span> : null}
                  </td>
                  <td className="px-3 py-2">{r.host.name}</td>
                  <td className="px-3 py-2">{tr(`kinds.${r.kind}`)}{r.frequentVisitor ? <span className="muted"> · {t("columns.frequent")}</span> : null}</td>
                  {showSite ? <td className="px-3 py-2">{r.site.name}</td> : null}
                  <td className="px-3 py-2">{r.pinHash ? t("filters.yes") : t("filters.no")}</td>
                  <td className="px-3 py-2">
                    {r.visits.length ? `${t("filters.yes")} · ${fmtDate(r.visits[0]!.enteredAt ?? r.validFrom, locale, { timeZone: r.site.timezone, dateStyle: "short", timeStyle: "short" })}` : t("filters.no")}
                  </td>
                  <td className="px-3 py-2"><PassStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right"><Link href={`/app/passes/${r.id}`} className="btn-secondary px-3 py-1 text-xs">{th("list.open")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination basePath="/admin/reports/invites" filters={filters} page={result.page} pages={result.pages} />
    </div>
  );
}
