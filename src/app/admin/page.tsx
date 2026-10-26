import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";

export default async function AdminHome() {
  const tenant = await requireMembership("admin", "/admin");
  const t = await getTranslations("admin");
  const [sites, users, devices, passes] = await Promise.all([
    db.site.findMany({ where: { active: true, ...tenant.siteFilter.siteId ? { id: tenant.siteFilter.siteId as string } : {} }, include: { _count: { select: { gates: true, areas: true } } }, orderBy: { name: "asc" } }),
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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("overview")}</h1>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="card">
            <dt className="muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
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
