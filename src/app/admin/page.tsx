import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Siren } from "lucide-react";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { fmtNumber } from "@/lib/format";
import { siteDashboardCounts } from "@/lib/server/reports";

export default async function AdminHome() {
  const tenant = await requireMembership("admin", "/admin");
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const [sites, users, devices, passes] = await Promise.all([
    db.site.findMany({ where: { active: true, ...(tenant.siteFilter.siteId ? { id: tenant.siteFilter.siteId } : {}) }, include: { _count: { select: { gates: true, areas: true } } }, orderBy: { name: "asc" } }),
    db.user.count({ where: { status: "active" } }),
    db.guardDevice.count({ where: { active: true, deviceTokenHash: { not: null }, ...tenant.siteFilter } }),
    db.pass.count({ where: { status: "active", validUntil: { gte: new Date() }, ...tenant.siteFilter } }),
  ]);
  const stats = [
    [t("stats.sites"), sites.length],
    [t("stats.users"), users],
    [t("stats.devices"), devices],
    [t("stats.passesToday"), passes],
  ] as const;
  const today = await Promise.all(sites.map(async (s) => ({ site: s, counts: await siteDashboardCounts(s) })));
  const countKeys = ["insideNow", "enteredToday", "pendingApprovals", "incidentsToday"] as const;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">{t("overview")}</h1>
        <Link href="/admin/evacuation" className="btn-danger" data-testid="evacuation-link"><Icon icon={Siren} /> {t("evacuation")}</Link>
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="card">
            <dt className="muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("dashboard.title")}</h2>
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="dashboard-today">
          {today.map(({ site, counts }) => (
            <li key={site.id} className="card">
              <p className="mb-2 font-medium">{site.name}</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {countKeys.map((k) => (
                  <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
                    <dt className="muted text-xs">{t(`dashboard.${k}`)}</dt>
                    <dd className={`text-xl font-semibold tabular-nums ${k === "incidentsToday" && counts[k] > 0 ? "text-danger" : ""}`}>{fmtNumber(counts[k], locale)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("sites")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {sites.map((s) => (
            <li key={s.id} className="card">
              <p className="font-medium">{s.name}</p>
              <p className="muted">{t("site.gates", { count: s._count.gates })} · {t("site.areas", { count: s._count.areas })} · {s.timezone}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
