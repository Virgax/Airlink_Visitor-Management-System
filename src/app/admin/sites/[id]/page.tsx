import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { Printer, QrCode } from "lucide-react";
import { Icon } from "@/components/Icon";
import { getManagedSite, readSiteSettings, timeZoneOptions } from "@/lib/server/sites";
import { readGateSettings, selfSignInPath } from "@/lib/server/gates";
import { VISIT_KINDS } from "@/lib/passes/form";
import { absoluteUrl } from "@/lib/notifications/channels/types";
import { readCheckpointAreaIds } from "@/lib/guard/checkpoint";
import { PRINTER_KINDS, readPrinter } from "@/lib/badges/config";
import { BADGE_TEMPLATES } from "@/lib/badges/zpl";
import { createAreaAction, createGateAction, toggleAreaAction, toggleGateAction, toggleSelfSignInAction, updateAreaAction, updateGatePrinterAction, updateCheckpointAreasAction, updateSelfSignInKindsAction, updateSiteAction } from "../actions";

const GATE_KINDS = ["pedestrian", "vehicle", "dock", "checkpoint"] as const;

export default async function SiteDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await requireMembership("admin", `/admin/sites/${id}`);
  const t = await getTranslations("admin.sitesPage");
  const tc = await getTranslations("admin.common");
  const tg = await getTranslations("admin.gateKinds");
  const tk = await getTranslations("admin.kinds");
  const ts = await getTranslations("ops.selfSignIn.admin");
  const tb = await getTranslations("badges");
  const site = await getManagedSite(tenant, id);
  if (!site) notFound();
  const settings = readSiteSettings(site);
  const [gates, areas] = await Promise.all([
    db.gate.findMany({ where: { siteId: site.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.area.findMany({ where: { siteId: site.id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const isGlobal = tenant.membership.siteId === null;
  const okText =
    sp.ok === "created" ? t("created")
    : sp.ok === "gate" ? t("gateAdded")
    : sp.ok === "area" ? t("areaAdded")
    : sp.ok === "selfSignInOn" ? ts("enabled")
    : sp.ok === "selfSignInOff" ? ts("disabled")
    : sp.ok === "printer" ? tb("admin.printerSaved")
    : sp.ok ? tc("saved")
    : null;
  const errorText = sp.error === "areaExists" ? t("errors.areaExists") : sp.error === "timezone" ? t("errors.timezone") : sp.error ? tc("invalid") : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="muted"><Link href="/admin/sites" className="underline">{t("title")}</Link></p>
        <h1 className="text-2xl font-semibold">{site.name}</h1>
      </div>
      {okText ? <p className="alert-ok" role="status">{okText}</p> : null}
      {errorText ? <p className="alert-error" role="alert">{errorText}</p> : null}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t("settings")}</h2>
        <form action={updateSiteAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="siteId" value={site.id} />
          <div>
            <label className="label" htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required minLength={2} maxLength={80} defaultValue={site.name} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="address">{t("address")}</label>
            <input id="address" name="address" maxLength={200} defaultValue={site.address ?? ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="timezone">{t("timezone")}</label>
            <select id="timezone" name="timezone" className="input" defaultValue={site.timezone}>
              {timeZoneOptions(site.timezone).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="retentionDays">{t("retentionDays")}</label>
            <input id="retentionDays" name="retentionDays" type="number" min={1} max={3650} required defaultValue={settings.retentionDays} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="unannouncedTimeoutMin">{t("unannouncedTimeoutMin")}</label>
            <input id="unannouncedTimeoutMin" name="unannouncedTimeoutMin" type="number" min={1} max={240} required defaultValue={settings.unannouncedTimeoutMin} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="badgeTemplate">{tb("admin.template")}</label>
            <select id="badgeTemplate" name="badgeTemplate" className="input" defaultValue={settings.badgeTemplate}>
              {BADGE_TEMPLATES.map((tpl) => <option key={tpl} value={tpl}>{tb(`templates.${tpl}`)}</option>)}
            </select>
          </div>
          {isGlobal ? (
            <div className="flex items-end">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" name="active" defaultChecked={site.active} /> {t("active")}
              </label>
            </div>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className="btn-primary">{tc("save")}</button>
          </div>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t("gates")}</h2>
        <form action={createGateAction} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="siteId" value={site.id} />
          <div>
            <label className="label" htmlFor="gateName">{t("gateName")}</label>
            <input id="gateName" name="name" required minLength={2} maxLength={80} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="gateKind">{t("gateKind")}</label>
            <select id="gateKind" name="kind" className="input" defaultValue="pedestrian">
              {GATE_KINDS.map((k) => <option key={k} value={k}>{tg(k)}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary">{t("addGate")}</button>
          </div>
        </form>
        {gates.length === 0 ? (
          <p className="muted">{t("noGates")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="gates">
            {gates.map((g) => {
              const selfKinds = readGateSettings(g).selfSignInKinds;
              const printer = readPrinter(g.settings);
              return (
                <li key={g.id} id={`gate-${g.id}`} className="space-y-2 py-3" data-testid="gate" data-gate-name={g.name}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{g.name}</p>
                      <p className="muted">{tg(g.kind)} · {g.active ? tc("active") : tc("inactive")}</p>
                    </div>
                    <form action={toggleSelfSignInAction}>
                      <input type="hidden" name="gateId" value={g.id} />
                      <button type="submit" className="btn-secondary text-sm" data-testid="toggle-self-sign-in">
                        <Icon icon={QrCode} /> {g.selfSignInToken ? ts("disable") : ts("enable")}
                      </button>
                    </form>
                    {g.selfSignInToken ? (
                      <Link href={`/admin/sites/${site.id}/gates/${g.id}/poster`} className="btn-secondary text-sm" data-testid="poster-link">
                        <Icon icon={Printer} /> {ts("poster")}
                      </Link>
                    ) : null}
                    <form action={toggleGateAction}>
                      <input type="hidden" name="gateId" value={g.id} />
                      <button type="submit" className="btn-secondary text-sm">{g.active ? t("deactivate") : t("activate")}</button>
                    </form>
                  </div>
                  <form action={updateGatePrinterAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3" aria-label={`${tb("admin.printer")} · ${g.name}`}>
                    <input type="hidden" name="gateId" value={g.id} />
                    <div>
                      <label className="label" htmlFor={`printerKind-${g.id}`}>{tb("admin.printer")}</label>
                      <select id={`printerKind-${g.id}`} name="printerKind" className="input text-sm" defaultValue={printer?.kind ?? "none"}>
                        <option value="none">{tb("printerKinds.none")}</option>
                        {PRINTER_KINDS.map((k) => <option key={k} value={k}>{tb(`printerKinds.${k}`)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor={`printerName-${g.id}`}>{tb("admin.printerName")}</label>
                      <input id={`printerName-${g.id}`} name="printerName" maxLength={80} defaultValue={printer?.name ?? ""} placeholder="ZP450" className="input text-sm" />
                    </div>
                    <button type="submit" className="btn-secondary text-sm">{tb("admin.savePrinter")}</button>
                  </form>
                  {g.kind === "checkpoint" ? (
                    <form action={updateCheckpointAreasAction} className="rounded-lg bg-surface-2 p-3" data-testid="checkpoint-settings">
                      <input type="hidden" name="gateId" value={g.id} />
                      <fieldset>
                        <legend className="label">{t("checkpointAreas")}</legend>
                        <div className="flex flex-wrap gap-3">
                          {areas.filter((a) => a.active).map((a) => (
                            <label key={a.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="checkpointAreaIds" value={a.id} defaultChecked={readCheckpointAreaIds(g.settings).includes(a.id)} /> {a.name}
                            </label>
                          ))}
                        </div>
                        <p className="muted mt-1 text-xs">{t("checkpointAreasHelp")}</p>
                      </fieldset>
                      <button type="submit" className="btn-secondary mt-2 text-sm">{tc("save")}</button>
                    </form>
                  ) : null}
                  {g.selfSignInToken ? (
                    <form action={updateSelfSignInKindsAction} className="rounded-lg bg-surface-2 p-3" data-testid="self-sign-in-settings">
                      <input type="hidden" name="gateId" value={g.id} />
                      <p className="muted mb-2 break-all">
                        {ts("url")}: <a href={selfSignInPath(g.selfSignInToken)} className="underline" target="_blank" rel="noopener" data-testid="self-sign-in-url">{absoluteUrl(selfSignInPath(g.selfSignInToken))}</a>
                      </p>
                      <fieldset>
                        <legend className="label">{ts("kinds")}</legend>
                        <div className="flex flex-wrap gap-3">
                          {VISIT_KINDS.map((k) => (
                            <label key={k} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="selfSignInKinds" value={k} defaultChecked={selfKinds.includes(k)} /> {tk(k)}
                            </label>
                          ))}
                        </div>
                        <p className="muted mt-1 text-xs">{ts("kindsHelp")}</p>
                      </fieldset>
                      <button type="submit" className="btn-secondary mt-2 text-sm">{tc("save")}</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t("areas")}</h2>
        <form action={createAreaAction} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="siteId" value={site.id} />
          <div className="sm:col-span-2">
            <label className="label" htmlFor="areaName">{t("areaName")}</label>
            <input id="areaName" name="name" required minLength={2} maxLength={80} className="input" />
          </div>
          <div className="flex flex-col justify-end gap-1">
            <label className="flex items-center gap-2"><input type="checkbox" name="restricted" /> {t("restricted")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="escortRequired" /> {t("escortRequired")}</label>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary">{t("addArea")}</button>
          </div>
        </form>
        {areas.length === 0 ? (
          <p className="muted">{t("noAreas")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="areas">
            {areas.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.name}</p>
                  <p className="muted">{a.active ? tc("active") : tc("inactive")}</p>
                </div>
                <form action={updateAreaAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="areaId" value={a.id} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" defaultChecked={a.restricted} /> {t("restricted")}</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="escortRequired" defaultChecked={a.escortRequired} /> {t("escortRequired")}</label>
                  <button type="submit" className="btn-secondary text-sm">{tc("save")}</button>
                </form>
                <form action={toggleAreaAction}>
                  <input type="hidden" name="areaId" value={a.id} />
                  <button type="submit" className="btn-secondary text-sm">{a.active ? t("deactivate") : t("activate")}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
