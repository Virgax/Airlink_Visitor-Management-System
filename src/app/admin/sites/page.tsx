import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { listManagedSites, timeZoneOptions } from "@/lib/server/sites";
import { createSiteAction } from "./actions";

export default async function SitesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/sites");
  const t = await getTranslations("admin.sitesPage");
  const tc = await getTranslations("admin.common");
  const ta = await getTranslations("admin");
  const sites = await listManagedSites(tenant);
  const counts = await db.site.findMany({ where: { id: { in: sites.map((s) => s.id) } }, select: { id: true, _count: { select: { gates: true, areas: true } } } });
  const countById = new Map(counts.map((c) => [c.id, c._count]));
  const isGlobal = tenant.membership.siteId === null;
  const errorKey = sp.error === "exists" ? "errors.exists" : sp.error === "timezone" ? "errors.timezone" : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {errorKey ? <p className="alert-error" role="alert">{t(errorKey)}</p> : sp.error ? <p className="alert-error" role="alert">{tc(sp.error === "forbidden" ? "forbidden" : "invalid")}</p> : null}

      {isGlobal ? (
        <form action={createSiteAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required minLength={2} maxLength={80} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="slug">{t("slug")}</label>
            <input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={40} className="input" aria-describedby="slug-help" />
            <p id="slug-help" className="muted mt-1">{t("slugHelp")}</p>
          </div>
          <div>
            <label className="label" htmlFor="address">{t("address")}</label>
            <input id="address" name="address" maxLength={200} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="timezone">{t("timezone")}</label>
            <select id="timezone" name="timezone" className="input" defaultValue="America/Santo_Domingo">
              {timeZoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn-primary">{t("create")}</button>
          </div>
        </form>
      ) : null}

      {sites.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sites.map((s) => {
            const c = countById.get(s.id) ?? { gates: 0, areas: 0 };
            return (
              <li key={s.id} className="card flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.name}{" "}
                    {!s.active ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{tc("inactive")}</span> : null}
                  </p>
                  <p className="muted">{ta("site.gates", { count: c.gates })} · {ta("site.areas", { count: c.areas })} · {s.timezone}</p>
                  {s.address ? <p className="muted truncate">{s.address}</p> : null}
                </div>
                <Link href={`/admin/sites/${s.id}`} className="btn-secondary text-sm">{t("manage")}</Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
