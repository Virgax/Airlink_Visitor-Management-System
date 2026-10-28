import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/ops/PrintButton";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber } from "@/lib/format";
import { evacuationGroups } from "@/lib/server/visits";

export const dynamic = "force-dynamic";

/**
 * Printable evacuation list across every site the tenant sees: visitors inside / at the dock (grouped by area and
 * host, as on the kiosk) plus employees who checked in through the gate QR (`EmployeePresence` still open).
 */
export default async function AdminEvacuationPage() {
  const tenant = await requireReportsTenant("/admin/evacuation");
  const t = await getTranslations("ops.evacuation");
  const tg = await getTranslations("guard.evacuation");
  const locale = await getLocale();
  const now = new Date();
  const sites = await Promise.all(
    tenant.sites.map(async (site) => {
      const [visitors, presences] = await Promise.all([
        evacuationGroups(site.id, tg("noArea")),
        db.employeePresence.findMany({
          where: { siteId: site.id, leftAt: null },
          select: { id: true, enteredAt: true, employee: { select: { name: true, department: true } }, gate: { select: { name: true } } },
          orderBy: { employee: { name: "asc" } },
        }),
      ]);
      return { site, visitors, presences };
    }),
  );
  const grandTotal = sites.reduce((n, s) => n + s.visitors.total + s.presences.length, 0);
  const time = (d: Date, tz: string) => fmtDate(d, locale, { timeZone: tz, dateStyle: undefined, timeStyle: "short" });

  return (
    <div className="space-y-6" data-testid="admin-evacuation">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <p className="muted print-hidden"><Link href="/admin" className="underline">{t("back")}</Link></p>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="muted">{t("generatedAt", { time: fmtDate(now, locale, { timeZone: tenant.sites[0]?.timezone }) })} · {t("total", { count: grandTotal })}</p>
        </div>
        <PrintButton label={tg("print")} />
      </div>

      {sites.map(({ site, visitors, presences }) => (
        <section key={site.id} className="card space-y-4 break-inside-avoid" data-testid="evacuation-site" data-site={site.name}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">{site.name}</h2>
            <p className="font-medium tabular-nums" data-testid="evacuation-site-total">
              {t("siteTotal", { count: visitors.total + presences.length })} · {t("visitors", { count: visitors.total })} · {t("employees", { count: presences.length })}
            </p>
          </div>
          {visitors.total === 0 && presences.length === 0 ? <p className="muted">{tg("empty")}</p> : null}
          {visitors.groups.map((g) => (
            <div key={g.area}>
              <h3 className="mb-1 font-semibold">{g.area} <span className="muted">({fmtNumber(g.visits.length, locale)})</span></h3>
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th className="py-1 pr-3">{tg("visitor")}</th>
                    <th className="py-1 pr-3">{t("company")}</th>
                    <th className="py-1 pr-3">{tg("host")}</th>
                    <th className="py-1 pr-3">{t("gate")}</th>
                    <th className="py-1 text-right">{t("since")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.visits.map((v) => (
                    <tr key={v.id} className="border-b border-border/50" data-testid="evacuation-visitor">
                      <td className="py-1 pr-3 font-medium">{v.visitorName}{v.badgeNo ? <span className="muted"> · {v.badgeNo}</span> : null}</td>
                      <td className="py-1 pr-3">{v.company?.name ?? "—"}</td>
                      <td className="py-1 pr-3">{v.host?.name ?? "—"}</td>
                      <td className="py-1 pr-3">{v.gate.name}</td>
                      <td className="py-1 text-right tabular-nums">{time(v.enteredAt ?? v.createdAt, site.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {presences.length > 0 ? (
            <div>
              <h3 className="mb-1 font-semibold">{t("employeesHeading")} <span className="muted">({fmtNumber(presences.length, locale)})</span></h3>
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b border-border">
                    <th className="py-1 pr-3">{t("employee")}</th>
                    <th className="py-1 pr-3">{t("department")}</th>
                    <th className="py-1 pr-3">{t("gate")}</th>
                    <th className="py-1 text-right">{t("since")}</th>
                  </tr>
                </thead>
                <tbody>
                  {presences.map((p) => (
                    <tr key={p.id} className="border-b border-border/50" data-testid="evacuation-employee">
                      <td className="py-1 pr-3 font-medium">{p.employee.name}</td>
                      <td className="py-1 pr-3">{p.employee.department ?? "—"}</td>
                      <td className="py-1 pr-3">{p.gate.name}</td>
                      <td className="py-1 text-right tabular-nums">{time(p.enteredAt, site.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
