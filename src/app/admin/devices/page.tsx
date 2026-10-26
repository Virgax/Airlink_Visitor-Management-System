import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { fmtDate } from "@/lib/format";
import { createDeviceAction, generateCodeAction } from "./actions";

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ device?: string; code?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/devices");
  const t = await getTranslations("admin.devicesPage");
  const locale = await getLocale();
  const sites = await db.site.findMany({ where: { active: true, ...(tenant.siteFilter.siteId ? { id: tenant.siteFilter.siteId as string } : {}) }, include: { gates: { where: { active: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
  const devices = await db.guardDevice.findMany({ where: { active: true, ...tenant.siteFilter }, include: { site: true, gate: true }, orderBy: { createdAt: "desc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>

      {sp.code && sp.device ? (
        <div className="alert-ok" role="status">
          <p className="font-medium">{t("codeTitle")}</p>
          <p className="my-1 font-mono text-2xl tracking-widest" data-testid="enroll-code">{sp.code}</p>
          <p>{t("codeHelp")}</p>
        </div>
      ) : null}

      <form action={createDeviceAction} className="card grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">{t("name")}</label>
          <input id="name" name="name" required minLength={2} placeholder={t("namePlaceholder")} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="siteId">{t("site")}</label>
          <select id="siteId" name="siteId" className="input" required>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="gateId">{t("gate")}</label>
          <select id="gateId" name="gateId" className="input" required>
            {sites.flatMap((s) => s.gates.map((g) => <option key={g.id} value={g.id}>{s.name} · {g.name}</option>))}
          </select>
        </div>
        <div className="sm:col-span-4">
          <button type="submit" className="btn-primary">{t("create")}</button>
        </div>
      </form>

      {devices.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id} className="card flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{d.name}</p>
                <p className="muted">{d.site.name} · {d.gate.name}</p>
                <p className="muted">
                  {d.deviceTokenHash ? t("enrolled") : t("notEnrolled")} · {t("lastSeen")}: {d.lastSeenAt ? fmtDate(d.lastSeenAt, locale, { timeZone: d.site.timezone }) : t("never")}
                </p>
              </div>
              <form action={generateCodeAction}>
                <input type="hidden" name="deviceId" value={d.id} />
                <button type="submit" className="btn-secondary text-sm">{t("generateCode")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
