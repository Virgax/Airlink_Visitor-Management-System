import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Pass, PassStatus } from "@prisma/client";
import { CalendarPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { HostNav } from "@/components/passes/HostNav";
import { PassStatusBadge } from "@/components/passes/PassStatusBadge";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requireMembership } from "@/lib/auth/guards";
import { ownPassWhere } from "@/lib/server/host-passes";
import { parseSchedule } from "@/lib/passes/validate";

const OPEN_STATUSES: PassStatus[] = ["active", "pending_approval"];

type Row = Pass & { company: { name: string } | null; site: { name: string; timezone: string } };

export default async function HostHome() {
  const tenant = await requireMembership("host", "/app");
  const t = await getTranslations("host");
  const tk = await getTranslations("passes");
  const ts = await getTranslations("selectPanel");
  const locale = await getLocale();
  const now = new Date();
  const own = ownPassWhere(tenant);
  const include = { company: { select: { name: true } }, site: { select: { name: true, timezone: true } } };
  const [upcoming, past] = await Promise.all([
    db.pass.findMany({ where: { AND: [own, { validUntil: { gte: now }, status: { in: OPEN_STATUSES } }] }, include, orderBy: { validFrom: "asc" }, take: 100 }),
    db.pass.findMany({ where: { AND: [own, { OR: [{ validUntil: { lt: now } }, { status: { notIn: OPEN_STATUSES } }] }] }, include, orderBy: { validFrom: "desc" }, take: 50 }),
  ]);
  const groupIds = [...new Set([...upcoming, ...past].map((p) => p.groupId).filter((g): g is string => !!g))];
  const groupCounts = new Map<string, number>();
  if (groupIds.length) {
    const counts = await db.pass.groupBy({ by: ["groupId"], where: { groupId: { in: groupIds } }, _count: { _all: true } });
    for (const c of counts) if (c.groupId) groupCounts.set(c.groupId, c._count._all);
  }

  const windowText = (p: Row) => {
    const schedule = parseSchedule(p.schedule);
    const range = `${fmtDate(p.validFrom, locale, { timeZone: p.site.timezone, dateStyle: "medium", timeStyle: "short" })} → ${fmtDate(p.validUntil, locale, { timeZone: p.site.timezone, dateStyle: "medium", timeStyle: "short" })}`;
    if (!schedule) return range;
    const days = schedule.days.map((d) => tk(`weekdays.${d}`)).join(" ");
    return `${range} · ${t("list.recurringWindow", { days, from: schedule.from, to: schedule.to })}`;
  };

  const table = (rows: Row[], empty: string) =>
    rows.length === 0 ? (
      <p className="muted">{empty}</p>
    ) : (
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2">{t("list.visitor")}</th>
              <th className="px-3 py-2">{t("list.kind")}</th>
              <th className="px-3 py-2">{t("list.window")}</th>
              <th className="px-3 py-2">{t("list.status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={`/app/passes/${p.id}`} className="font-medium hover:underline">{p.visitorName}</Link>
                  {p.company ? <span className="muted"> · {p.company.name}</span> : null}
                  {p.groupId ? <span className="muted block">{t("list.group", { count: groupCounts.get(p.groupId) ?? 1 })}</span> : null}
                  {!tenant.site ? <span className="muted block">{p.site.name}</span> : null}
                </td>
                <td className="px-3 py-2">{tk(`kinds.${p.kind}.label`)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{windowText(p)}</td>
                <td className="px-3 py-2"><PassStatusBadge status={p.status} /></td>
                <td className="px-3 py-2 text-right"><Link href={`/app/passes/${p.id}`} className="btn-secondary px-3 py-1 text-xs">{t("list.open")}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <AppShell user={tenant.user} subtitle={tenant.site?.name ?? ts("allSites")} title={t("title")}>
      <HostNav userId={tenant.user.id} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="muted flex-1">{t("intro")}</p>
        <Link href="/app/passes/new" className="btn-primary"><Icon icon={CalendarPlus} /> {t("invite")}</Link>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("list.upcoming")}</h2>
        {table(upcoming, t("list.emptyUpcoming"))}
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">{t("list.past")}</h2>
        {table(past, t("list.emptyPast"))}
      </section>
    </AppShell>
  );
}
