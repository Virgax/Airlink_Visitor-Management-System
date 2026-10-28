import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { VisitKind } from "@prisma/client";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { DEFAULT_POLICIES } from "@/lib/policies/evaluate";
import { listManagedSites } from "@/lib/server/sites";
import { resetPolicyAction, savePolicyAction } from "./actions";

const KINDS: VisitKind[] = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"];
const ROLES = ["security", "approver"] as const;

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ site?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/policies");
  const t = await getTranslations("admin.policiesPage");
  const tc = await getTranslations("admin.common");
  const tk = await getTranslations("admin.kinds");
  const tr = await getTranslations("roles");
  const tb = await getTranslations("badges.admin");
  const sites = (await listManagedSites(tenant)).filter((s) => s.active);
  const site = sites.find((s) => s.id === sp.site) ?? sites.find((s) => s.id === tenant.site?.id) ?? sites[0];

  if (!site) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted">{t("empty")}</p>
      </div>
    );
  }
  const [policies, gates] = await Promise.all([
    db.visitPolicy.findMany({ where: { siteId: site.id } }),
    db.gate.findMany({ where: { siteId: site.id, active: true }, orderBy: { name: "asc" } }),
  ]);
  const byKind = new Map(policies.map((p) => [p.kind, p]));
  const okText = sp.ok === "reset" ? t("resetDone") : sp.ok ? t("saved") : null;
  const errorText = sp.error === "autoSignOut" ? t("errors.autoSignOut") : sp.error === "emails" ? t("errors.emails") : sp.error ? tc("invalid") : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {okText ? <p className="alert-ok" role="status">{okText}</p> : null}
      {errorText ? <p className="alert-error" role="alert">{errorText}</p> : null}

      {sites.length > 1 ? (
        <nav aria-label={t("site")} className="flex flex-wrap gap-2">
          {sites.map((s) => (
            <Link key={s.id} href={`/admin/policies?site=${s.id}`} aria-current={s.id === site.id ? "page" : undefined} className={s.id === site.id ? "btn-primary text-sm" : "btn-secondary text-sm"}>
              {s.name}
            </Link>
          ))}
        </nav>
      ) : (
        <p className="muted">{t("site")}: {site.name}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((kind) => {
          const saved = byKind.get(kind);
          const p = saved ?? { kind, ...DEFAULT_POLICIES[kind], enabled: true, autoSignOutAt: null, notifyEmails: [] as string[], autoPrintBadge: false };
          const id = (f: string) => `${kind}-${f}`;
          return (
            <form key={kind} id={`policy-${kind}`} action={savePolicyAction} className="card space-y-3" aria-labelledby={id("title")} data-testid={`policy-${kind}`}>
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="kind" value={kind} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={id("title")} className="text-lg font-semibold">{tk(kind)}</h2>
                {!saved ? <span className="muted">{t("unsaved")}</span> : !p.enabled ? <span className="rounded-md bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">{t("disabledTag")}</span> : null}
              </div>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={p.enabled} /> {t("enabled")}</label>
              <p className="muted -mt-2 text-xs">{t("enabledHelp")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresApproval" defaultChecked={p.requiresApproval} /> {t("requiresApproval")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresDoc" defaultChecked={p.requiresDoc} /> {t("requiresDoc")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresNda" defaultChecked={p.requiresNda} /> {t("requiresNda")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="escortRequired" defaultChecked={p.escortRequired} /> {t("escortRequired")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="badge" defaultChecked={p.badge} /> {t("badge")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="receptionOnly" defaultChecked={p.receptionOnly} /> {t("receptionOnly")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoPrintBadge" defaultChecked={p.autoPrintBadge} /> {tb("autoPrintBadge")}</label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={id("approverRole")}>{t("approverRole")}</label>
                  <select id={id("approverRole")} name="approverRole" className="input" defaultValue={p.approverRole ?? ""}>
                    <option value="">{t("noApprover")}</option>
                    {ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={id("maxDurationMin")}>{t("maxDurationMin")}</label>
                  <input id={id("maxDurationMin")} name="maxDurationMin" type="number" min={5} max={10080} placeholder={t("noLimit")} defaultValue={p.maxDurationMin ?? ""} className="input" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={id("autoSignOutAt")}>{t("autoSignOutAt")}</label>
                  <input id={id("autoSignOutAt")} name="autoSignOutAt" type="time" defaultValue={p.autoSignOutAt ?? ""} className="input" aria-describedby={id("autoSignOutHelp")} />
                  <p id={id("autoSignOutHelp")} className="muted mt-1 text-xs">{t("autoSignOutHelp", { tz: site.timezone })}</p>
                </div>
                <div>
                  <label className="label" htmlFor={id("notifyEmails")}>{t("notifyEmails")}</label>
                  <input id={id("notifyEmails")} name="notifyEmails" type="text" defaultValue={p.notifyEmails.join(", ")} placeholder={t("notifyEmailsPlaceholder")} className="input" aria-describedby={id("notifyEmailsHelp")} maxLength={1000} />
                  <p id={id("notifyEmailsHelp")} className="muted mt-1 text-xs">{t("notifyEmailsHelp")}</p>
                </div>
              </div>
              <fieldset>
                <legend className="label">{t("allowedGates")}</legend>
                <div className="flex flex-wrap gap-3">
                  {gates.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="allowedGateIds" value={g.id} defaultChecked={p.allowedGateIds.includes(g.id)} /> {g.name}
                    </label>
                  ))}
                  {gates.length === 0 ? <span className="muted">{t("anyGate")}</span> : <span className="muted">({t("anyGate")})</span>}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary text-sm">{t("save")}</button>
                <button type="submit" formAction={resetPolicyAction} className="btn-secondary text-sm">{t("reset")}</button>
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
