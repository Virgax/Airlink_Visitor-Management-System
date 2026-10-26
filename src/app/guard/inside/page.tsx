import { getLocale, getTranslations } from "next-intl/server";
import { LogOut, Truck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { KioskBar } from "@/components/guard/KioskBar";
import { requireKiosk } from "@/lib/auth/kiosk";
import { fmtDate } from "@/lib/format";
import { listOpenVisits } from "@/lib/server/visits";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InsidePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { user, site, gate } = await requireKiosk();
  const t = await getTranslations("guard");
  const locale = await getLocale();
  const visits = await listOpenVisits(site.id);

  return (
    <AppShell user={user} kiosk subtitle={`${site.name} · ${gate.name}`}>
      <KioskBar title={t("inside.title")}>
        <span className="muted">{t("inside.count", { count: visits.length })}</span>
      </KioskBar>
      {sp.ok ? <p className="alert-ok mb-4" role="status">{t("inside.ok")}</p> : null}
      {sp.error ? <p className="alert-error mb-4" role="alert">{t("inside.error")}</p> : null}
      {visits.length === 0 ? (
        <p className="muted">{t("inside.empty")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="inside-list">
          {visits.map((v) => (
            <li key={v.id} className="card flex flex-wrap items-center gap-3" data-testid="inside-visit">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">{v.visitorName}</p>
                <p className="muted">
                  {[v.company?.name, t(`kinds.${v.kind}`)].filter(Boolean).join(" · ")}
                  {v.host ? ` · ${t("scan.host")}: ${v.host.name}` : ""}
                </p>
                <p className="muted">
                  {t("inside.gate")}: {v.gate.name} · {t("inside.enteredAt")}: {v.enteredAt ? fmtDate(v.enteredAt, locale, { timeZone: site.timezone, dateStyle: undefined, timeStyle: "short" }) : "—"}
                  {v.plate ? ` · ${t("scan.plate")}: ${v.plate}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${v.status === "at_dock" ? "bg-warning-bg text-warning" : "bg-success-bg text-success"}`}>{t(`status.${v.status}`)}</span>
                  {v.conflict ? <span className="rounded-full bg-danger-bg px-2 py-0.5 text-danger">{t("inside.conflict")}</span> : null}
                </p>
              </div>
              <form action={checkoutAction}>
                <input type="hidden" name="visitId" value={v.id} />
                <button type="submit" className="btn-primary">
                  <Icon icon={v.status === "at_dock" ? Truck : LogOut} /> {v.status === "at_dock" ? t("inside.dockLeft") : t("inside.checkout")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
