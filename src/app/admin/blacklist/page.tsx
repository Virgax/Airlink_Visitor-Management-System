import { getLocale, getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { addBlacklistAction, removeBlacklistAction } from "./actions";

export default async function BlacklistPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/blacklist");
  const t = await getTranslations("admin.blacklistPage");
  const tc = await getTranslations("admin.common");
  const locale = await getLocale();
  const isGlobal = tenant.membership.siteId === null;
  const sites = tenant.sites;
  const entries = await db.blacklist.findMany({
    where: isGlobal ? {} : { OR: [{ siteId: null }, { siteId: { in: sites.map((s) => s.id) } }] },
    include: { site: { select: { name: true, timezone: true } }, createdBy: { select: { name: true } }, company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const now = Date.now();
  const okText = sp.ok === "removed" ? t("removed") : sp.ok ? t("added") : null;
  const errorText = sp.error === "value" ? t("errors.value") : sp.error === "exists" ? t("errors.exists") : sp.error === "forbidden" ? tc("forbidden") : sp.error ? tc("invalid") : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {okText ? <p className="alert-ok" role="status">{okText}</p> : null}
      {errorText ? <p className="alert-error" role="alert">{errorText}</p> : null}

      <form action={addBlacklistAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="label">{t("type")}</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="type" value="doc" defaultChecked /> {t("byDoc")}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="type" value="plate" /> {t("byPlate")}</label>
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="value">{t("value")}</label>
          <input id="value" name="value" required maxLength={40} autoComplete="off" className="input" aria-describedby="value-help" />
          <p id="value-help" className="muted mt-1">{t("valueHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" name="name" maxLength={120} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="siteId">{t("site")}</label>
          <select id="siteId" name="siteId" className="input" defaultValue={isGlobal ? "" : (sites[0]?.id ?? "")}>
            {isGlobal ? <option value="">{t("allSites")}</option> : null}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="reason">{t("reason")}</label>
          <input id="reason" name="reason" required minLength={3} maxLength={500} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="until">{t("until")}</label>
          <input id="until" name="until" type="date" className="input" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn-primary">{t("add")}</button>
        </div>
      </form>

      {entries.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="blacklist">
          {entries.map((e) => {
            const expired = e.until ? e.until.getTime() < now : false;
            const canRemove = e.siteId ? true : isGlobal;
            return (
              <li key={e.id} className="card flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {e.plate ? t("plate", { plate: e.plate }) : t("doc")}
                    {e.name ? ` · ${e.name}` : ""}
                    {e.company ? ` · ${e.company.name}` : ""}
                  </p>
                  <p>{e.reason}</p>
                  <p className="muted">
                    {e.site?.name ?? t("allSites")} · {e.until ? fmtDate(e.until, locale, { dateStyle: "medium", timeStyle: undefined, timeZone: e.site?.timezone ?? "America/Santo_Domingo" }) : t("permanent")}
                    {expired ? ` · ${t("expired")}` : ""} · {t("addedBy", { name: e.createdBy.name })}
                  </p>
                </div>
                {canRemove ? (
                  <form action={removeBlacklistAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className="btn-secondary text-sm">{t("remove")}</button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
