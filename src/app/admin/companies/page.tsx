import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { saveCompanyAction, toggleCompanyBlockedAction } from "./actions";

const KINDS = ["vendor", "contractor", "client", "carrier", "courier", "other"] as const;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  await requireMembership("admin", "/admin/companies");
  const t = await getTranslations("admin.companiesPage");
  const tc = await getTranslations("admin.common");
  const tk = await getTranslations("admin.companyKinds");
  const q = (sp.q ?? "").trim();
  const [companies, editing] = await Promise.all([
    db.company.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { rnc: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { name: "asc" },
      take: 200,
    }),
    sp.edit ? db.company.findUnique({ where: { id: sp.edit } }) : Promise.resolve(null),
  ]);
  const okText = sp.ok === "added" ? t("added") : sp.ok ? t("saved") : null;
  const errorText = sp.error === "exists" ? t("errors.exists") : sp.error ? tc("invalid") : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {okText ? <p className="alert-ok" role="status">{okText}</p> : null}
      {errorText ? <p className="alert-error" role="alert">{errorText}</p> : null}

      <form action={saveCompanyAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={editing ? t("editing", { name: editing.name }) : t("add")}>
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        {editing ? <p className="muted sm:col-span-2 lg:col-span-4">{t("editing", { name: editing.name })}</p> : null}
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" name="name" required minLength={2} maxLength={120} defaultValue={editing?.name ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="rnc">{t("rnc")}</label>
          <input id="rnc" name="rnc" maxLength={20} defaultValue={editing?.rnc ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="kind">{t("kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={editing?.kind ?? "vendor"}>
            {KINDS.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 py-2" title={t("blockedHelp")}>
            <input type="checkbox" name="blocked" defaultChecked={editing?.blocked ?? false} /> {t("blocked")}
          </label>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="label" htmlFor="notes">{t("notes")}</label>
          <textarea id="notes" name="notes" maxLength={1000} rows={2} defaultValue={editing?.notes ?? ""} className="input" />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn-primary">{editing ? t("update") : t("add")}</button>
          {editing ? <Link href="/admin/companies" className="btn-secondary">{t("cancel")}</Link> : null}
        </div>
      </form>

      <form method="get" action="/admin/companies" className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="q">{t("search")}</label>
          <input id="q" name="q" type="search" defaultValue={q} className="input" />
        </div>
        <button type="submit" className="btn-secondary">{t("search")}</button>
      </form>

      {companies.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("rnc")}</th>
                <th className="px-3 py-2">{t("kind")}</th>
                <th className="px-3 py-2">{t("blocked")}</th>
                <th className="px-3 py-2">{t("notes")}</th>
                <th className="px-3 py-2">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.rnc ?? ""}</td>
                  <td className="px-3 py-2">{tk(c.kind)}</td>
                  <td className="px-3 py-2">{c.blocked ? tc("yes") : tc("no")}</td>
                  <td className="max-w-xs truncate px-3 py-2">{c.notes ?? ""}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/admin/companies?edit=${c.id}`} className="btn-secondary text-sm">{t("edit")}</Link>
                      <form action={toggleCompanyBlockedAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn-secondary text-sm">{c.blocked ? t("unblock") : t("block")}</button>
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
