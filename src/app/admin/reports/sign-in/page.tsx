import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PersonPicker } from "@/components/ops/PersonPicker";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { db } from "@/lib/db";
import { enabledKinds } from "@/lib/server/policies";
import { manualSignInAction, searchHostsAdminAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = { siteId?: string; ok?: string; error?: string };
const ERRORS = ["invalid", "host", "company_blocked", "blacklisted"];

/** "Registrar visita": manual sign-in from a reception PC without kiosk enrollment (admin or security). */
export default async function ManualSignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/reports/sign-in");
  const t = await getTranslations("ops.signIn");
  const tk = await getTranslations("admin.kinds");
  const site = tenant.site ?? tenant.sites.find((s) => s.id === sp.siteId) ?? (tenant.sites.length === 1 ? tenant.sites[0] : null) ?? null;
  const errorKey = sp.error && ERRORS.includes(sp.error) ? sp.error : null;
  const okVisit = sp.ok ? await db.visit.findFirst({ where: { id: sp.ok, ...tenant.siteFilter }, select: { visitorName: true, badgeNo: true, status: true } }) : null;

  const header = (
    <div>
      <p className="muted"><Link href="/admin/reports" className="underline">{t("back")}</Link></p>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="muted mt-1">{t("intro")}</p>
    </div>
  );

  if (!site) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card space-y-3">
          <p className="font-medium">{t("chooseSite")}</p>
          <ul className="flex flex-wrap gap-2">
            {tenant.sites.map((s) => (
              <li key={s.id}><Link href={`/admin/reports/sign-in?siteId=${s.id}`} className="btn-secondary">{s.name}</Link></li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const [gates, kinds] = await Promise.all([
    db.gate.findMany({ where: { siteId: site.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    enabledKinds(site.id),
  ]);
  const search = searchHostsAdminAction.bind(null, site.id);
  const pickerLabels = { label: t("host"), placeholder: t("hostPlaceholder"), help: t("hostHelp"), searching: t("searching"), none: t("none"), selected: t("hostSelected"), change: t("change") };

  return (
    <div className="space-y-6">
      {header}
      {okVisit ? <p className="alert-ok" role="status" data-testid="sign-in-ok">{t("ok", { name: okVisit.visitorName })}</p> : null}
      {errorKey ? <p className="alert-error" role="alert">{t(`errors.${errorKey}` as "errors.invalid")}</p> : null}
      {tenant.sites.length > 1 && !tenant.site ? (
        <p className="muted">{t("site")}: {site.name} · <Link href="/admin/reports/sign-in" className="underline">{t("changeSite")}</Link></p>
      ) : null}
      {gates.length === 0 ? (
        <p className="alert-error">{t("noGates")}</p>
      ) : (
        <form action={manualSignInAction} className="card max-w-2xl space-y-4" data-testid="sign-in-form">
          <input type="hidden" name="siteId" value={site.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="gateId">{t("gate")}</label>
              <select id="gateId" name="gateId" className="input" defaultValue={gates[0]?.id} required>
                {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="kind">{t("kind")}</label>
              <select id="kind" name="kind" className="input" defaultValue={kinds.includes("visit") ? "visit" : kinds[0]} required>
                {kinds.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
              </select>
            </div>
          </div>
          <PersonPicker name="hostEmployeeId" search={search} labels={pickerLabels} inputId="hostSearch" />
          <div>
            <label className="label" htmlFor="visitorName">{t("visitor")}</label>
            <input id="visitorName" name="visitorName" required minLength={2} maxLength={120} autoComplete="off" className="input" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="company">{t("company")}</label>
              <input id="company" name="company" maxLength={120} autoComplete="off" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="doc">{t("doc")}</label>
              <input id="doc" name="doc" maxLength={40} autoComplete="off" inputMode="numeric" className="input" aria-describedby="doc-help" />
              <p id="doc-help" className="muted mt-1 text-xs">{t("docHelp")}</p>
            </div>
            <div>
              <label className="label" htmlFor="plate">{t("plate")}</label>
              <input id="plate" name="plate" maxLength={16} autoComplete="off" autoCapitalize="characters" className="input uppercase" />
            </div>
          </div>
          <button type="submit" className="btn-primary">{t("submit")}</button>
          <p className="muted text-xs">{t("auditNote")}</p>
        </form>
      )}
    </div>
  );
}
