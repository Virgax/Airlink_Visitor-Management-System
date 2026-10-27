import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { searchEmployees } from "@/lib/server/employees";
import { saveEmployeeAction, toggleEmployeeAction } from "./actions";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/employees");
  const t = await getTranslations("admin.employeesPage");
  const tc = await getTranslations("admin.common");
  const locale = await getLocale();
  const q = (sp.q ?? "").trim();
  const isGlobal = tenant.membership.siteId === null;
  const sites = tenant.sites;
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const [employees, editing, lastSync] = await Promise.all([
    searchEmployees(tenant.site?.id ?? null, q, { limit: 100, includeInactive: true }),
    sp.edit
      ? db.employee.findFirst({ where: { id: sp.edit, ...(isGlobal ? {} : { OR: [{ siteId: null }, { siteId: { in: sites.map((s) => s.id) } }] }) } })
      : Promise.resolve(null),
    db.employee.findFirst({ where: { source: { not: "manual" } }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);
  const editable = editing && editing.source === "manual" && (!editing.siteId || isGlobal || sites.some((s) => s.id === editing.siteId)) ? editing : null;
  const okText = sp.ok === "added" ? t("added") : sp.ok ? t("saved") : null;
  const errorText = sp.error === "exists" ? t("errors.exists") : sp.error === "synced" ? t("errors.synced") : sp.error === "forbidden" ? tc("forbidden") : sp.error ? tc("invalid") : null;
  const qParam = q ? `&q=${encodeURIComponent(q)}` : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
        {lastSync ? <p className="muted">{t("lastSync", { date: fmtDate(lastSync.syncedAt, locale, { timeZone: tenant.site?.timezone ?? "America/Santo_Domingo" }) })}</p> : null}
      </div>
      {okText ? <p className="alert-ok" role="status">{okText}</p> : null}
      {errorText ? <p className="alert-error" role="alert">{errorText}</p> : null}

      <form action={saveEmployeeAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={editable ? t("editing", { name: editable.name }) : t("add")}>
        {editable ? <input type="hidden" name="id" value={editable.id} /> : null}
        <input type="hidden" name="q" value={q} />
        {editable ? <p className="muted sm:col-span-2 lg:col-span-3">{t("editing", { name: editable.name })}</p> : null}
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" name="name" required minLength={2} maxLength={120} defaultValue={editable?.name ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">{t("email")}</label>
          <input id="email" name="email" type="email" maxLength={200} defaultValue={editable?.email ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="department">{t("department")}</label>
          <input id="department" name="department" maxLength={80} defaultValue={editable?.department ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="extension">{t("extension")}</label>
          <input id="extension" name="extension" maxLength={20} defaultValue={editable?.extension ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t("phone")}</label>
          <input id="phone" name="phone" maxLength={30} defaultValue={editable?.phone ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="siteId">{t("site")}</label>
          <select id="siteId" name="siteId" className="input" defaultValue={editable?.siteId ?? (isGlobal ? "" : (tenant.site?.id ?? sites[0]?.id ?? ""))}>
            {isGlobal ? <option value="">{t("noSite")}</option> : null}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn-primary">{editable ? t("update") : t("add")}</button>
          {editable ? <Link href={`/admin/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="btn-secondary">{t("cancel")}</Link> : null}
        </div>
      </form>

      <form method="get" action="/admin/employees" className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="q">{t("searchLabel")}</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} className="input" />
        </div>
        <button type="submit" className="btn-secondary">{t("search")}</button>
      </form>

      <p className="muted" aria-live="polite">{t("results", { count: employees.length })}</p>
      {employees.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="employees">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("email")}</th>
                <th className="px-3 py-2">{t("department")}</th>
                <th className="px-3 py-2">{t("extension")}</th>
                <th className="px-3 py-2">{t("site")}</th>
                <th className="px-3 py-2">{t("source")}</th>
                <th className="px-3 py-2">{t("status")}</th>
                <th className="px-3 py-2">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{e.name}</td>
                  <td className="px-3 py-2">{e.email ?? ""}</td>
                  <td className="px-3 py-2">{e.department ?? ""}</td>
                  <td className="px-3 py-2">{e.extension ?? ""}</td>
                  <td className="px-3 py-2">{e.siteId ? (siteName.get(e.siteId) ?? "") : t("noSite")}</td>
                  <td className="px-3 py-2" title={e.source !== "manual" ? t("syncedNote") : undefined}>{t(`sources.${e.source}`)}</td>
                  <td className="px-3 py-2">{e.active ? tc("active") : tc("inactive")}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {e.source === "manual" ? <Link href={`/admin/employees?edit=${e.id}${qParam}`} className="btn-secondary text-sm">{t("edit")}</Link> : null}
                      <form action={toggleEmployeeAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="q" value={q} />
                        <button type="submit" className="btn-secondary text-sm">{e.active ? t("deactivate") : t("activate")}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
