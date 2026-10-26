import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Icon } from "@/components/Icon";
import { EXPORT_MAX_ROWS } from "@/lib/server/reports";
import { filtersToQuery } from "@/lib/server/reports-filters";

export type ReportKey = "visits" | "audit" | "shifts";

export const REPORT_PATHS: Record<ReportKey, string> = { visits: "/admin/reports", audit: "/admin/reports/audit", shifts: "/admin/reports/shifts" };

/** Tabs between the three reports. */
export async function ReportNav({ active }: { active: ReportKey }) {
  const t = await getTranslations("reports");
  return (
    <nav aria-label={t("title")} className="flex flex-wrap gap-2">
      {(Object.keys(REPORT_PATHS) as ReportKey[]).map((k) => (
        <Link key={k} href={REPORT_PATHS[k]} className={active === k ? "btn-primary text-sm" : "btn-secondary text-sm"} aria-current={active === k ? "page" : undefined}>
          {t(`nav.${k}`)}
        </Link>
      ))}
    </nav>
  );
}

/** Date range + site + gate selects shared by every report (GET form fields). */
export async function RangeSiteGateFields({
  filters,
  sites,
  gates,
  showSite,
}: {
  filters: { from: string; to: string; siteId?: string; gateId?: string };
  sites: { id: string; name: string }[];
  gates: { id: string; name: string; siteId: string; siteName: string }[];
  showSite: boolean;
}) {
  const t = await getTranslations("reports.filters");
  const visibleGates = filters.siteId ? gates.filter((g) => g.siteId === filters.siteId) : gates;
  return (
    <>
      <div>
        <label className="label" htmlFor="from">{t("from")}</label>
        <input id="from" name="from" type="date" className="input" defaultValue={filters.from} required />
      </div>
      <div>
        <label className="label" htmlFor="to">{t("to")}</label>
        <input id="to" name="to" type="date" className="input" defaultValue={filters.to} required />
      </div>
      {showSite ? (
        <div>
          <label className="label" htmlFor="siteId">{t("site")}</label>
          <select id="siteId" name="siteId" className="input" defaultValue={filters.siteId ?? ""}>
            <option value="">{t("all")}</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : null}
      <div>
        <label className="label" htmlFor="gateId">{t("gate")}</label>
        <select id="gateId" name="gateId" className="input" defaultValue={filters.gateId ?? ""}>
          <option value="">{t("all")}</option>
          {visibleGates.map((g) => <option key={g.id} value={g.id}>{showSite ? `${g.siteName} · ${g.name}` : g.name}</option>)}
        </select>
      </div>
    </>
  );
}

export async function FilterActions({ clearHref, exportHref }: { clearHref: string; exportHref: string }) {
  const t = await getTranslations("reports.filters");
  return (
    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
      <button type="submit" className="btn-primary">{t("apply")}</button>
      <Link href={clearHref} className="btn-secondary">{t("clear")}</Link>
      <a href={exportHref} className="btn-secondary ml-auto" download>
        <Icon icon={Download} /> {t("export")}
      </a>
      <span className="muted w-full sm:w-auto">{t("exportHelp", { max: EXPORT_MAX_ROWS })}</span>
    </div>
  );
}

export async function Pagination({ basePath, filters, page, pages }: { basePath: string; filters: Record<string, string | number | undefined>; page: number; pages: number }) {
  const t = await getTranslations("reports.pagination");
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3" aria-label={t("page", { page, pages })}>
      {page > 1 ? (
        <Link href={`${basePath}${filtersToQuery(filters, { page: page - 1 })}`} className="btn-secondary text-sm"><Icon icon={ChevronLeft} /> {t("prev")}</Link>
      ) : <span />}
      <span className="muted">{t("page", { page, pages })}</span>
      {page < pages ? (
        <Link href={`${basePath}${filtersToQuery(filters, { page: page + 1 })}`} className="btn-secondary text-sm">{t("next")} <Icon icon={ChevronRight} /></Link>
      ) : <span />}
    </nav>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls =
    status === "inside" || status === "at_dock" ? "bg-success-bg text-success"
    : status === "denied" || status === "timeout" ? "bg-danger-bg text-danger"
    : status === "pending" ? "bg-warning-bg text-warning"
    : "bg-surface-2 text-text";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
