import { getLocale, getTranslations } from "next-intl/server";
import type { MembershipRole, Pass } from "@prisma/client";
import { Check, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { HostNav } from "@/components/passes/HostNav";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requireApproverTenants } from "@/lib/server/approvals";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import { parseSchedule } from "@/lib/passes/validate";
import { approvePassAction, denyPassAction } from "./actions";

type Search = { ok?: string; error?: string };
type Row = Pass & {
  site: { name: string; timezone: string };
  host: { name: string; department: string | null };
  company: { name: string } | null;
  escort: { name: string } | null;
  role: MembershipRole;
};

/** Pending passes for approvers (management) and security, each seeing the kinds their role must approve. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { user, tenants, roles } = await requireApproverTenants("/app/approvals");
  const t = await getTranslations("host.approvalsPage");
  const tk = await getTranslations("passes");
  const tr = await getTranslations("roles");
  const ts = await getTranslations("selectPanel");
  const locale = await getLocale();

  const rows = new Map<string, Row>();
  for (const role of roles) {
    const tenant = tenants[role]!;
    const passes = await db.pass.findMany({
      where: { ...tenant.siteFilter, status: "pending_approval", validUntil: { gte: new Date() } },
      include: { site: { select: { name: true, timezone: true } }, host: { select: { name: true, department: true } }, company: { select: { name: true } }, escort: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const siteIds = [...new Set(passes.map((p) => p.siteId))];
    const policies = siteIds.length ? await db.visitPolicy.findMany({ where: { siteId: { in: siteIds } } }) : [];
    for (const p of passes) {
      const policy = policies.find((x) => x.siteId === p.siteId && x.kind === p.kind) ?? null;
      const approver = evaluatePolicy(policy, { kind: p.kind }).approverRole ?? "security";
      if (approver === role && !rows.has(p.id)) rows.set(p.id, { ...p, role });
    }
  }
  const pending = [...rows.values()];
  const areaIds = [...new Set(pending.flatMap((p) => p.areaIds))];
  const areas = areaIds.length ? await db.area.findMany({ where: { id: { in: areaIds } }, select: { id: true, name: true } }) : [];
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? id;
  const subtitle = roles.map((r) => tenants[r]?.site?.name ?? ts("allSites")).filter((v, i, a) => a.indexOf(v) === i).join(" · ");

  return (
    <AppShell user={user} subtitle={subtitle} title={t("title")}>
      <HostNav userId={user.id} />
      <p className="muted mb-4">{t("intro")}</p>
      {sp.ok ? <p className="alert-ok mb-4" role="status">{t(`ok.${sp.ok === "denied" ? "denied" : "approved"}`)}</p> : null}
      {sp.error ? <p className="alert-error mb-4" role="alert">{t("error")}</p> : null}
      {pending.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((p) => {
            const schedule = parseSchedule(p.schedule);
            const tz = p.site.timezone;
            return (
              <li key={p.id} className="card space-y-3" data-testid="pending-pass">
                <div>
                  <p className="text-lg font-medium">{p.visitorName}{p.company ? <span className="muted"> · {p.company.name}</span> : null}</p>
                  <p className="muted">{tk(`kinds.${p.kind}.label`)} · {p.site.name} · {t("role", { role: tr(p.role) })}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="muted">{t("host")}</dt><dd>{p.host.name}{p.host.department ? ` · ${p.host.department}` : ""}</dd>
                  <dt className="muted">{t("window")}</dt>
                  <dd>
                    {fmtDate(p.validFrom, locale, { timeZone: tz })} → {fmtDate(p.validUntil, locale, { timeZone: tz })}
                    {schedule ? <span className="muted block">{schedule.days.map((d) => tk(`weekdays.${d}`)).join(" ")} · {schedule.from}–{schedule.to}</span> : null}
                  </dd>
                  <dt className="muted">{t("areas")}</dt><dd>{p.areaIds.map(areaName).join(", ") || "—"}</dd>
                  <dt className="muted">{t("escort")}</dt><dd>{p.escort?.name ?? "—"}</dd>
                  <dt className="muted">{t("requested")}</dt><dd>{fmtDate(p.createdAt, locale, { timeZone: tz })}</dd>
                  {p.note ? <><dt className="muted">·</dt><dd className="whitespace-pre-wrap">{p.note}</dd></> : null}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <form action={approvePassAction}>
                    <input type="hidden" name="passId" value={p.id} />
                    <button type="submit" className="btn-primary"><Icon icon={Check} /> {t("approve")}</button>
                  </form>
                  <form action={denyPassAction}>
                    <input type="hidden" name="passId" value={p.id} />
                    <button type="submit" className="btn-secondary text-danger"><Icon icon={X} /> {t("deny")}</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
