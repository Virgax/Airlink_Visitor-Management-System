import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { IdCard, Pencil, UserPlus, UserX } from "lucide-react";
import { Icon } from "@/components/Icon";
import { PassStatusBadge } from "@/components/passes/PassStatusBadge";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { parseSchedule } from "@/lib/passes/validate";
import { deactivateFrequentAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = { q?: string; inactive?: string; ok?: string; error?: string };

/** Frequent visitors list: admins manage, security reads and prints cards. */
export default async function FrequentListPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tenant = await requireReportsTenant("/admin/frequent");
  const readOnly = tenant.role !== "admin";
  const t = await getTranslations("people.frequent");
  const tk = await getTranslations("passes");
  const locale = await getLocale();
  const q = (sp.q ?? "").trim();
  const showInactive = sp.inactive === "1";
  const rows = await db.frequentVisitor.findMany({
    where: {
      ...tenant.siteFilter,
      ...(showInactive ? {} : { active: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: { company: { select: { name: true } }, pass: { select: { id: true, status: true, validUntil: true, schedule: true, uses: true } }, site: { select: { name: true, timezone: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 500,
  });
  const ok = sp.ok && ["created", "saved", "deactivated", "activated"].includes(sp.ok) ? sp.ok : null;
  const error = sp.error === "notFound" ? "notFound" : sp.error === "forbidden" ? "forbidden" : null;
  const showSite = tenant.sites.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="muted mt-1">{t("intro")}</p>
          {readOnly ? <p className="muted mt-1">{t("readOnly")}</p> : null}
        </div>
        {!readOnly ? <Link href="/admin/frequent/new" className="btn-primary"><Icon icon={UserPlus} /> {t("add")}</Link> : null}
      </div>
      {ok ? <p className="alert-ok" role="status">{t(`ok.${ok as "created"}`)}</p> : null}
      {error ? <p className="alert-error" role="alert">{t(`errors.${error}`)}</p> : null}

      <form method="get" action="/admin/frequent" className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="q">{t("searchLabel")}</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} className="input" />
        </div>
        <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} /> {t("showInactive")}</label>
        <button type="submit" className="btn-secondary">{t("search")}</button>
      </form>

      {rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="frequent-table">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">{t("columns.name")}</th>
                <th className="px-3 py-2">{t("columns.company")}</th>
                <th className="px-3 py-2">{t("columns.doc")}</th>
                <th className="px-3 py-2">{t("columns.signIn")}</th>
                <th className="px-3 py-2">{t("columns.schedule")}</th>
                <th className="px-3 py-2">{t("columns.pass")}</th>
                <th className="px-3 py-2">{t("columns.status")}</th>
                <th className="px-3 py-2">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const schedule = parseSchedule(r.pass?.schedule);
                return (
                  <tr key={r.id} className="border-t border-border" data-testid="frequent-row">
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {showSite ? <span className="muted block font-normal">{r.site.name}</span> : null}
                    </td>
                    <td className="px-3 py-2">{r.company?.name ?? "—"}</td>
                    <td className="px-3 py-2">{r.docLast4 ? t("docEnding", { last4: r.docLast4 }) : t("noDoc")}</td>
                    <td className="px-3 py-2">{t(`signIn.${r.signIn}`)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{schedule ? `${schedule.days.map((d) => tk(`weekdays.${d}`)).join(" ")} · ${schedule.from}–${schedule.to}` : "—"}</td>
                    <td className="px-3 py-2">
                      {r.pass ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <PassStatusBadge status={r.pass.status} />
                          <span className="muted">{fmtDate(r.pass.validUntil, locale, { timeZone: r.site.timezone, dateStyle: "short", timeStyle: undefined })}</span>
                        </span>
                      ) : t("noPass")}
                    </td>
                    <td className="px-3 py-2">{r.active ? t("active") : t("inactive")}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/admin/frequent/${r.id}/card`} className="btn-secondary px-3 py-1 text-xs"><Icon icon={IdCard} size={14} /> {t("card")}</Link>
                        {!readOnly ? <Link href={`/admin/frequent/${r.id}`} className="btn-secondary px-3 py-1 text-xs"><Icon icon={Pencil} size={14} /> {t("edit")}</Link> : null}
                        {!readOnly && r.active ? (
                          <form action={deactivateFrequentAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="btn-secondary px-3 py-1 text-xs text-danger"><Icon icon={UserX} size={14} /> {t("deactivate")}</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
