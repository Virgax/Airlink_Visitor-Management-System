import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { MembershipRole } from "@prisma/client";
import { KeyRound, UserMinus, UserPlus } from "lucide-react";
import { Icon } from "@/components/Icon";
import { requireMembership } from "@/lib/auth/guards";
import { parsePeopleQuery, PEOPLE_PAGE_SIZES, PEOPLE_TABS, queryPeople, type PersonRow } from "@/lib/server/people";
import { addPersonAction, bulkDeactivateAction, setPinAction, toggleActiveAction, toggleRoleAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const CHIP_ROLES = ["admin", "security", "approver", "warden"] as const satisfies readonly MembershipRole[];
const OK_KEYS = ["added", "saved", "pinSet", "deactivated", "roleOn", "roleOff"];
const ERROR_KEYS = ["invalid", "exists", "pin", "weakPin", "forbidden", "noEmail", "needEmail", "nothing", "self"];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/people");
  const t = await getTranslations("people.directory");
  const tc = await getTranslations("admin.common");
  const query = parsePeopleQuery(sp);
  const isGlobal = tenant.membership.siteId === null;
  const scope = { siteIds: isGlobal ? null : tenant.sites.map((s) => s.id) };
  const result = await queryPeople(scope, query);
  const siteName = new Map(tenant.sites.map((s) => [s.id, s.name]));
  const ok = typeof sp.ok === "string" && OK_KEYS.includes(sp.ok) ? sp.ok : null;
  const error = typeof sp.error === "string" && ERROR_KEYS.includes(sp.error) ? sp.error : null;
  const count = Number(sp.count ?? 0);
  const scopeLabel = tenant.site?.name ?? t("allSites");
  const link = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: query.q, tab: query.tab, perPage: query.pageSize, page: query.page, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || (k === "tab" && v === "all") || (k === "page" && Number(v) <= 1) || (k === "perPage" && Number(v) === 25)) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return `/admin/people${s ? `?${s}` : ""}`;
  };
  const hidden = (
    <>
      <input type="hidden" name="q" value={query.q} />
      <input type="hidden" name="tab" value={query.tab} />
      <input type="hidden" name="perPage" value={query.pageSize} />
      <input type="hidden" name="page" value={query.page} />
    </>
  );
  const roleScope = (r: PersonRow["roles"][number]) => (r.siteId ? (siteName.get(r.siteId) ?? r.siteId) : t("allSites"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {ok ? <p className="alert-ok" role="status">{ok === "deactivated" ? t("ok.deactivated", { count }) : t(`ok.${ok as "added"}`)}</p> : null}
      {error ? <p className="alert-error" role="alert">{t(`errors.${error as "invalid"}`)}</p> : null}

      <details className="card" open={Boolean(error === "invalid" || error === "exists" || error === "needEmail")}>
        <summary className="cursor-pointer font-medium"><Icon icon={UserPlus} className="mr-1 inline" /> {t("add")}</summary>
        <p className="muted mt-2">{t("addIntro")}</p>
        <form action={addPersonAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("add")}>
          {hidden}
          <div>
            <label className="label" htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required minLength={2} maxLength={120} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="email">{t("email")}</label>
            <input id="email" name="email" type="email" maxLength={200} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="department">{t("department")}</label>
            <input id="department" name="department" maxLength={80} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="extension">{t("extension")}</label>
            <input id="extension" name="extension" maxLength={20} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="phone">{t("phone")}</label>
            <input id="phone" name="phone" maxLength={30} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="siteId">{t("site")}</label>
            <select id="siteId" name="siteId" className="input" defaultValue={isGlobal ? (tenant.site?.id ?? "") : (tenant.site?.id ?? tenant.sites[0]?.id ?? "")}>
              {isGlobal ? <option value="">{t("noSite")}</option> : null}
              {tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="label">{t("rolesLabel")}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {CHIP_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2"><input type="checkbox" name="roles" value={r} /> {t(`roles.${r}`)}</label>
              ))}
            </div>
            <p className="muted mt-1">{t("rolesHelp")}</p>
          </fieldset>
          <div>
            <label className="label" htmlFor="pin">{t("pinField")}</label>
            <input id="pin" name="pin" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} className="input" autoComplete="off" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn-primary">{t("submit")}</button>
          </div>
        </form>
      </details>

      <form method="get" action="/admin/people" className="flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="tab" value={query.tab} />
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="q">{t("searchLabel")}</label>
          <input id="q" name="q" type="search" defaultValue={query.q} placeholder={t("searchPlaceholder")} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="perPage">{t("perPage")}</label>
          <select id="perPage" name="perPage" className="input" defaultValue={query.pageSize}>
            {PEOPLE_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-secondary">{t("search")}</button>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label={t("title")} data-testid="people-tabs">
        {PEOPLE_TABS.map((tab) => (
          <Link key={tab} href={link({ tab, page: 1 })} className={tab === query.tab ? "btn-primary text-sm" : "btn-secondary text-sm"} aria-current={tab === query.tab ? "page" : undefined} data-testid={`people-tab-${tab}`}>
            {t(`tabs.${tab}`)} <span className="opacity-70">({result.counts[tab]})</span>
          </Link>
        ))}
      </nav>

      <form id="bulk-form" action={bulkDeactivateAction} className="flex flex-wrap items-center gap-3">
        {hidden}
        <button type="submit" className="btn-secondary text-danger" data-testid="bulk-deactivate"><Icon icon={UserMinus} /> {t("bulkDeactivate")}</button>
        <span className="muted">{t("bulkHelp")}</span>
        <span className="muted ml-auto" aria-live="polite">{t("results", { count: result.total })}</span>
      </form>

      {result.rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="people-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2"><span className="sr-only">{t("columns.select")}</span></th>
                <th className="px-3 py-2">{t("columns.name")}</th>
                <th className="px-3 py-2">{t("columns.email")}</th>
                <th className="px-3 py-2">{t("columns.department")}</th>
                <th className="px-3 py-2">{t("columns.site")}</th>
                <th className="px-3 py-2">{t("columns.roles")}</th>
                <th className="px-3 py-2">{t("columns.pin")}</th>
                <th className="px-3 py-2">{t("columns.status")}</th>
                <th className="px-3 py-2">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.key} className="border-t border-border" data-testid="person-row" data-key={row.key} data-active={row.active ? "1" : "0"}>
                  <td className="px-3 py-2">
                    <input type="checkbox" name="ids" value={row.key} form="bulk-form" aria-label={t("selectRow", { name: row.name })} className="h-4 w-4" />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {row.name}
                    <span className="muted block font-normal" title={row.source === "user" ? t("userOnly") : undefined}>{t(`source.${row.source}`)}</span>
                  </td>
                  <td className="px-3 py-2">{row.email ?? "—"}</td>
                  <td className="px-3 py-2">{row.department ?? "—"}</td>
                  <td className="px-3 py-2">{row.siteId ? (siteName.get(row.siteId) ?? "") : t("noSite")}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1" data-testid="role-chips">
                      {row.employeeId ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.active ? "bg-success-bg text-success" : "bg-surface-2 text-text-muted"}`} title={row.active ? undefined : t("hostInactive")} data-role="host" data-on={row.active ? "1" : "0"}>
                          {t("roles.host")}
                        </span>
                      ) : null}
                      {CHIP_ROLES.map((role) => {
                        const held = row.roles.filter((r) => r.role === role);
                        const on = held.length > 0;
                        const scopes = held.map(roleScope).join(", ");
                        const title = !row.email ? t("roleNeedsEmail") : on ? t("roleOn", { role: t(`roles.${role}`), scope: scopes }) : t("roleOff", { role: t(`roles.${role}`), scope: scopeLabel });
                        return (
                          <form key={role} action={toggleRoleAction} className="inline">
                            {hidden}
                            <input type="hidden" name="key" value={row.key} />
                            <input type="hidden" name="role" value={role} />
                            <button
                              type="submit"
                              disabled={!row.email}
                              title={title}
                              aria-pressed={on}
                              aria-label={`${t(`roles.${role}`)} · ${row.name}`}
                              data-role={role}
                              data-on={on ? "1" : "0"}
                              className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${on ? "border-primary bg-primary text-primary-contrast" : "border-border bg-surface text-text-muted hover:bg-surface-2"}`}
                            >
                              {t(`roles.${role}`)}{on && held.some((h) => h.siteId) ? <span className="ml-1 opacity-80">· {scopes}</span> : null}
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <form action={setPinAction} className="flex items-center gap-1">
                      {hidden}
                      <input type="hidden" name="key" value={row.key} />
                      <span className={`text-xs ${row.hasPin ? "text-success" : "muted"}`} data-testid="pin-state">{row.hasPin ? t("pinOn") : t("pinOff")}</span>
                      <input name="pin" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} placeholder={t("pinPlaceholder")} aria-label={t("pinLabel", { name: row.name })} autoComplete="off" className="input w-28 px-2 py-1 text-xs" disabled={!row.employeeId && !row.userId} />
                      <button type="submit" className="btn-secondary px-2 py-1 text-xs" title={t("pinHelp")}><Icon icon={KeyRound} size={14} /> {row.hasPin ? t("pinReset") : t("pinSet")}</button>
                    </form>
                  </td>
                  <td className="px-3 py-2">{row.active ? tc("active") : tc("inactive")}</td>
                  <td className="px-3 py-2">
                    <form action={toggleActiveAction}>
                      {hidden}
                      <input type="hidden" name="key" value={row.key} />
                      <input type="hidden" name="active" value={row.active ? "0" : "1"} />
                      <button type="submit" className="btn-secondary px-3 py-1 text-xs">{row.active ? t("deactivate") : t("activate")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label={t("page", { page: result.page, pages: result.pages })}>
          {result.page > 1 ? <Link href={link({ page: result.page - 1 })} className="btn-secondary text-sm">{t("prev")}</Link> : <span />}
          <span className="muted">{t("page", { page: result.page, pages: result.pages })}</span>
          {result.page < result.pages ? <Link href={link({ page: result.page + 1 })} className="btn-secondary text-sm">{t("next")}</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
