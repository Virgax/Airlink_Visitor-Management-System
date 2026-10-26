import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Check, CheckCheck, Footprints, Settings, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { fmtDate } from "@/lib/format";
import { DEFAULT_TIMEZONE } from "@/lib/notifications/quietHours";
import { renderNotification } from "@/lib/notifications/render";
import { isNotificationType } from "@/lib/notifications/types";
import { decideVisitAction, markAllReadAction, markReadAction, openAction } from "./actions";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

function asPayload(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : {};
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/app/notifications");
  const t = await getTranslations("notifications");
  const locale = await getLocale();

  const rows = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: 50,
  });
  const unread = rows.filter((r) => !r.readAt).length;

  // Site time zones for the timestamps and the pending visits this user may act on.
  const siteIds = [...new Set(rows.map((r) => asPayload(r.payload).siteId).filter((s): s is string => typeof s === "string"))];
  const sites = siteIds.length ? await db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, timezone: true } }) : [];
  const tzBySite = new Map(sites.map((s) => [s.id, s.timezone]));

  const visitIds = [...new Set(rows.filter((r) => r.type === "visit_at_gate").map((r) => asPayload(r.payload).visitId).filter((v): v is string => typeof v === "string"))];
  const visits = visitIds.length ? await db.visit.findMany({ where: { id: { in: visitIds } }, select: { id: true, status: true, siteId: true, hostEmployeeId: true } }) : [];
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const staff = await db.membership.findMany({ where: { userId: user.id, status: "active", role: { in: ["security", "admin"] } }, select: { siteId: true } });
  const staffEverywhere = staff.some((m) => m.siteId === null);
  const staffSites = new Set(staff.map((m) => m.siteId).filter((s): s is string => !!s));
  const mayDecide = (v: { siteId: string; hostEmployeeId: string | null }) =>
    (v.hostEmployeeId !== null && v.hostEmployeeId === user.employeeId) || staffEverywhere || staffSites.has(v.siteId);

  const ok = sp.ok === "approved" ? t("ok.approved") : sp.ok === "denied" ? t("ok.denied") : sp.ok === "onMyWay" ? t("ok.onMyWay") : sp.ok === "read" ? t("ok.read") : null;
  const error = sp.error === "gone" ? t("error.gone") : sp.error === "forbidden" ? t("error.forbidden") : sp.error === "invalid" ? t("error.invalid") : null;

  return (
    <AppShell user={user} title={t("title")}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="muted mr-auto">{t("unreadCount", { count: unread })}</p>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <button type="submit" className="btn-secondary text-sm"><Icon icon={CheckCheck} /> {t("markAllRead")}</button>
          </form>
        ) : null}
        <Link href="/account/notifications" className="btn-secondary text-sm"><Icon icon={Settings} /> {t("preferences")}</Link>
      </div>
      {ok ? <p className="alert-ok mb-4" role="status">{ok}</p> : null}
      {error ? <p className="alert-error mb-4" role="alert">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="notification-list">
          {rows.map((n) => {
            const payload = asPayload(n.payload);
            const type = isNotificationType(n.type) ? n.type : null;
            const rendered = type ? renderNotification(type, payload, locale) : { title: n.type, body: "", url: "/app/notifications" };
            const siteId = typeof payload.siteId === "string" ? payload.siteId : null;
            const timeZone = (siteId && tzBySite.get(siteId)) || DEFAULT_TIMEZONE;
            const visitId = type === "visit_at_gate" && typeof payload.visitId === "string" ? payload.visitId : null;
            const visit = visitId ? visitById.get(visitId) : undefined;
            const showDecision = visit?.status === "pending" && mayDecide(visit);
            return (
              <li key={n.id} className={`card space-y-2 ${n.readAt ? "" : "border-primary/40"}`} data-testid="notification-item" data-unread={n.readAt ? "false" : "true"}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {n.readAt ? null : <span className="mr-2 rounded bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-contrast">{t("unread")}</span>}
                      {rendered.title}
                    </p>
                    {rendered.body ? <p className="muted">{rendered.body}</p> : null}
                    <p className="text-xs text-text-muted">{fmtDate(n.createdAt, locale, { timeZone })}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!n.readAt ? (
                      <form action={markReadAction}>
                        <input type="hidden" name="id" value={n.id} />
                        <button type="submit" className="btn-secondary px-2 py-1 text-sm" title={t("markRead")} aria-label={t("markRead")}><Icon icon={Check} /></button>
                      </form>
                    ) : null}
                    <form action={openAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className="btn-secondary px-3 py-1 text-sm">{t("open")} <Icon icon={ArrowRight} /></button>
                    </form>
                  </div>
                </div>
                {visit ? (
                  showDecision ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="visit-decision">
                      <span className="muted mr-auto">{t("visit.pending")}</span>
                      {(["approve", "onMyWay", "deny"] as const).map((decision) => (
                        <form key={decision} action={decideVisitAction}>
                          <input type="hidden" name="id" value={n.id} />
                          <input type="hidden" name="visitId" value={visit.id} />
                          <input type="hidden" name="decision" value={decision} />
                          <button type="submit" className={decision === "deny" ? "btn-secondary text-sm" : "btn-primary text-sm"}>
                            <Icon icon={decision === "approve" ? Check : decision === "deny" ? X : Footprints} /> {t(`visit.${decision}`)}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : (
                    <p className="muted border-t border-border pt-2" data-testid="visit-status">{t("visit.status", { status: visit.status })}</p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
