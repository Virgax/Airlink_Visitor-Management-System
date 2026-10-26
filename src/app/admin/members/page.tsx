import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { addMemberAction } from "./actions";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/members");
  const t = await getTranslations("admin.membersPage");
  const tr = await getTranslations("roles");
  const tc = await getTranslations("selectPanel");
  const sites = tenant.sites;
  const memberships = await db.membership.findMany({
    where: tenant.membership.siteId === null ? {} : { siteId: { in: sites.map((s) => s.id) } },
    include: { user: true, site: true },
    orderBy: [{ user: { name: "asc" } }, { role: "asc" }],
  });
  const errorKey = sp.error === "pin" ? "errors.pin" : sp.error === "exists" ? "errors.exists" : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {sp.ok ? <p className="alert-ok" role="status">{t("added")}</p> : null}
      {errorKey ? <p className="alert-error" role="alert">{t(errorKey)}</p> : null}

      <form action={addMemberAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label" htmlFor="email">{t("email")}</label>
          <input id="email" name="email" type="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" name="name" required minLength={2} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="role">{t("role")}</label>
          <select id="role" name="role" className="input" defaultValue="host">
            {(["host", "approver", "security", "admin"] as const).map((r) => <option key={r} value={r}>{tr(r)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="siteId">{t("site")}</label>
          <select id="siteId" name="siteId" className="input" defaultValue={tenant.membership.siteId === null ? "" : (sites[0]?.id ?? "")}>
            {tenant.membership.siteId === null ? <option value="">{tc("allSites")}</option> : null}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pin">{t("pin")}</label>
          <input id="pin" name="pin" inputMode="numeric" pattern="[0-9]{4,8}" className="input" autoComplete="off" />
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn-primary">{t("add")}</button>
        </div>
      </form>

      {memberships.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("email")}</th>
                <th className="px-3 py-2">{t("role")}</th>
                <th className="px-3 py-2">{t("site")}</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2">{m.user.name}</td>
                  <td className="px-3 py-2">{m.user.email}</td>
                  <td className="px-3 py-2">{tr(m.role)}</td>
                  <td className="px-3 py-2">{m.site?.name ?? tc("allSites")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
