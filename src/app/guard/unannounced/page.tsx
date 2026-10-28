import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { KioskBar } from "@/components/guard/KioskBar";
import { HostPicker } from "@/components/guard/HostPicker";
import { PendingVisits } from "@/components/guard/PendingVisits";
import { requireKiosk } from "@/lib/auth/kiosk";
import { kioskBadgeConfig } from "@/lib/server/badges";
import { listGateVisits, visitJson } from "@/lib/server/visits";
import { createUnannouncedAction, searchHostsAction } from "./actions";

const KINDS = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"] as const;

export default async function UnannouncedPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { user, site, gate } = await requireKiosk();
  const t = await getTranslations("guard");
  const locale = await getLocale();
  const initial = (await listGateVisits(site.id)).map(visitJson);
  const errorKey = sp.error && ["invalid", "host", "blacklisted", "company_blocked"].includes(sp.error) ? sp.error : null;

  return (
    <AppShell user={user} kiosk subtitle={`${site.name} · ${gate.name}`}>
      <KioskBar title={t("unannounced.title")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={createUnannouncedAction} className="card space-y-4">
          <p className="muted">{t("unannounced.intro")}</p>
          {sp.ok ? <p className="alert-ok" role="status">{t("unannounced.ok")}</p> : null}
          {errorKey ? <p className="alert-error" role="alert">{t(`unannounced.errors.${errorKey}` as "unannounced.errors.invalid")}</p> : null}
          <HostPicker search={searchHostsAction} />
          <div>
            <label className="label" htmlFor="visitorName">{t("unannounced.visitor")}</label>
            <input id="visitorName" name="visitorName" required minLength={2} maxLength={120} autoComplete="off" className="input" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="company">{t("unannounced.company")}</label>
              <input id="company" name="company" maxLength={120} autoComplete="off" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="kind">{t("unannounced.kind")}</label>
              <select id="kind" name="kind" className="input" defaultValue="visit">
                {KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="doc">{t("unannounced.doc")}</label>
              <input id="doc" name="doc" maxLength={40} autoComplete="off" inputMode="numeric" className="input" aria-describedby="doc-help" />
              <p id="doc-help" className="muted mt-1 text-xs">{t("unannounced.docHelp")}</p>
            </div>
            <div>
              <label className="label" htmlFor="plate">{t("unannounced.plate")}</label>
              <input id="plate" name="plate" maxLength={16} autoComplete="off" autoCapitalize="characters" className="input uppercase" />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full">{t("unannounced.submit")}</button>
        </form>
        <section className="card">
          <h2 className="mb-1 text-lg font-semibold">{t("unannounced.pending")}</h2>
          <p className="muted mb-3">{t("unannounced.refresh", { seconds: 4 })}</p>
          <PendingVisits initial={initial} locale={locale} timeZone={site.timezone} badgeConfig={kioskBadgeConfig(site, gate)} />
        </section>
      </div>
    </AppShell>
  );
}
