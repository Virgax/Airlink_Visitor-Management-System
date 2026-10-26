import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { HostNav } from "@/components/passes/HostNav";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { ownPassWhere } from "@/lib/server/host-passes";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import { VISIT_KINDS } from "@/lib/passes/form";
import { toLocalInput } from "@/lib/time/tz";
import { createPassAction } from "../actions";

type Search = { siteId?: string; from?: string; error?: string };
const ERRORS = ["invalid", "missing_doc", "missing_plate", "gate_not_allowed", "company_blocked", "window_order", "window_too_long", "window_past", "schedule", "site"];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default async function NewPassPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("host", "/app/passes/new");
  const t = await getTranslations("host.new");
  const tk = await getTranslations("passes");
  const tr = await getTranslations("roles");
  const ts = await getTranslations("selectPanel");
  const ta = await getTranslations("app");

  // Site: the active one from the panel selector, or chosen here when the membership covers every site.
  const site = tenant.site ?? tenant.sites.find((s) => s.id === sp.siteId) ?? (tenant.sites.length === 1 ? tenant.sites[0] : null) ?? null;
  const shell = (children: React.ReactNode) => (
    <AppShell user={tenant.user} subtitle={site?.name ?? ts("allSites")} title={t("title")}>
      <HostNav userId={tenant.user.id} />
      {children}
    </AppShell>
  );
  if (!site) {
    return shell(
      <div className="card space-y-3">
        <p className="font-medium">{t("chooseSite")}</p>
        <ul className="flex flex-wrap gap-2">
          {tenant.sites.map((s) => (
            <li key={s.id}><Link href={`/app/passes/new?siteId=${s.id}`} className="btn-secondary">{s.name}</Link></li>
          ))}
        </ul>
      </div>,
    );
  }

  const [areas, gates, employees, policies, from] = await Promise.all([
    db.area.findMany({ where: { siteId: site.id, active: true }, orderBy: { name: "asc" } }),
    db.gate.findMany({ where: { siteId: site.id, active: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { active: true, OR: [{ siteId: site.id }, { siteId: null }] }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, department: true } }),
    db.visitPolicy.findMany({ where: { siteId: site.id } }),
    sp.from ? db.pass.findFirst({ where: { id: sp.from, ...ownPassWhere(tenant) } }) : null,
  ]);
  const approvalByKind = Object.fromEntries(
    VISIT_KINDS.map((kind) => [kind, evaluatePolicy(policies.find((p) => p.kind === kind) ?? null, { kind }).approverRole] as const),
  );
  const fromCompany = from?.companyId ? await db.company.findUnique({ where: { id: from.companyId }, select: { name: true } }) : null;
  const errorKey = sp.error && ERRORS.includes(sp.error) ? sp.error : null;
  const now = new Date();
  const start = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
  const defaultFrom = toLocalInput(start, site.timezone);
  const defaultUntil = toLocalInput(new Date(start.getTime() + 2 * 3_600_000), site.timezone);

  return shell(
    <form action={createPassAction} className="space-y-6">
      <input type="hidden" name="siteId" value={site.id} />
      <p className="muted">{t("intro")}</p>
      {errorKey ? <p className="alert-error" role="alert">{t(`errors.${errorKey}`)}</p> : null}

      <div className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="kind">{t("kind")}</label>
          <select id="kind" name="kind" className="input" defaultValue={from?.kind ?? "visit"} required>
            {VISIT_KINDS.map((k) => <option key={k} value={k}>{tk(`kinds.${k}.label`)}</option>)}
          </select>
          <ul className="muted mt-2 grid gap-1 sm:grid-cols-2">
            {VISIT_KINDS.map((k) => (
              <li key={k}>
                <span className="font-medium text-text">{tk(`kinds.${k}.label`)}:</span> {tk(`kinds.${k}.help`)}
                {approvalByKind[k] ? <span className="text-warning"> {t("pendingNotice", { role: tr(approvalByKind[k]!) })}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <label className="label" htmlFor="visitorName">{t("visitorName")}</label>
          <input id="visitorName" name="visitorName" required minLength={2} maxLength={120} className="input" defaultValue={from?.visitorName ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="company">{t("company")}</label>
          <input id="company" name="company" maxLength={120} className="input" defaultValue={fromCompany?.name ?? ""} />
          <p className="muted mt-1">{t("companyHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="phone">{t("phone")}</label>
          <input id="phone" name="phone" type="tel" maxLength={40} className="input" defaultValue={from?.visitorPhone ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="email">{t("email")}</label>
          <input id="email" name="email" type="email" maxLength={200} className="input" defaultValue={from?.visitorEmail ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="doc">{t("doc")}</label>
          <input id="doc" name="doc" maxLength={40} className="input" autoComplete="off" />
          <p className="muted mt-1">{t("docHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="plate">{t("plate")}</label>
          <input id="plate" name="plate" maxLength={20} className="input" defaultValue={from?.plate ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="note">{t("note")}</label>
          <textarea id="note" name="note" maxLength={500} rows={2} className="input" defaultValue={from?.note ?? ""} />
        </div>
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="label">{t("areas")}</legend>
          <ul className="space-y-1">
            {areas.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="areaIds" value={a.id} defaultChecked={from?.areaIds.includes(a.id) ?? false} />
                  {a.name}
                  {a.restricted ? <span className="muted">({t("areaRestricted")})</span> : null}
                  {a.escortRequired ? <span className="muted">({t("areaEscort")})</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div>
          <label className="label" htmlFor="escortEmployeeId">{t("escort")}</label>
          <select id="escortEmployeeId" name="escortEmployeeId" className="input" defaultValue={from?.escortEmployeeId ?? ""}>
            <option value="">{t("escortNone")}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.department ? ` · ${e.department}` : ""}</option>)}
          </select>
        </div>
        <fieldset>
          <legend className="label">{t("gates")}</legend>
          <ul className="space-y-1">
            {gates.map((g) => (
              <li key={g.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="gateIds" value={g.id} defaultChecked={from?.gateIds.includes(g.id) ?? false} /> {g.name}
                </label>
              </li>
            ))}
          </ul>
          <p className="muted mt-1">{t("gatesHelp")}</p>
        </fieldset>
        <div>
          <label className="label" htmlFor="groupSize">{t("groupSize")}</label>
          <input id="groupSize" name="groupSize" type="number" min={1} max={50} defaultValue={1} className="input" />
          <p className="muted mt-1">{t("groupHelp")}</p>
        </div>
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("mode")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="once" defaultChecked={!from?.schedule} /> {t("once")}</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode" value="recurring" defaultChecked={!!from?.schedule} /> {t("recurring")}</label>
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="validFrom">{t("validFrom")}</label>
          <input id="validFrom" name="validFrom" type="datetime-local" required className="input" defaultValue={defaultFrom} />
        </div>
        <div>
          <label className="label" htmlFor="validUntil">{t("validUntil")}</label>
          <input id="validUntil" name="validUntil" type="datetime-local" required className="input" defaultValue={defaultUntil} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("days")}</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {WEEK.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" name="days" value={d} /> {tk(`weekdays.${d}`)}
              </label>
            ))}
          </div>
          <p className="muted mt-1">{t("scheduleHelp")}</p>
        </fieldset>
        <div>
          <label className="label" htmlFor="scheduleFrom">{t("scheduleFrom")}</label>
          <input id="scheduleFrom" name="scheduleFrom" type="time" className="input" defaultValue="08:00" />
        </div>
        <div>
          <label className="label" htmlFor="scheduleTo">{t("scheduleTo")}</label>
          <input id="scheduleTo" name="scheduleTo" type="time" className="input" defaultValue="17:00" />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">{t("submit")}</button>
        <Link href="/app" className="btn-secondary">{ta("cancel")}</Link>
      </div>
    </form>,
  );
}
