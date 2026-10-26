import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Camera, ClipboardList } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";
import { requireKioskSession } from "@/lib/auth/kiosk-session";
import { fmtDate } from "@/lib/format";
import { mediaConfigured } from "@/lib/media/putFile";
import { SHIFT_LOG_KINDS, SHIFT_LOG_TEXT_MAX } from "@/lib/server/reports-filters";
import { localParts, zonedStartOfDay } from "@/lib/time/tz";
import { addShiftLogAction } from "./actions";

const KIND_CLASS: Record<(typeof SHIFT_LOG_KINDS)[number], string> = {
  note: "bg-surface-2 text-text",
  incident: "bg-danger-bg text-danger",
  round: "bg-success-bg text-success",
  handover: "bg-warning-bg text-warning",
};

export default async function ShiftLogPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { device, user, site } = await requireKioskSession();
  const t = await getTranslations("guard.log");
  const tk = await getTranslations("reports.shiftKinds");
  const locale = await getLocale();
  const photosEnabled = mediaConfigured();

  const start = zonedStartOfDay(localParts(new Date(), site.timezone).ymd, site.timezone);
  const entries = await db.shiftLog.findMany({
    where: { siteId: site.id, gateId: device.gateId, at: { gte: start } },
    include: { guard: { select: { name: true } } },
    orderBy: { at: "desc" },
    take: 200,
  });

  const ok = sp.ok === "nophoto" ? t("savedNoPhoto") : sp.ok ? t("saved") : null;
  const errorKey = sp.error === "photoType" ? "errors.photoType" : sp.error === "photoSize" ? "errors.photoSize" : sp.error === "rateLimited" ? "errors.rateLimited" : sp.error ? "errors.invalid" : null;

  return (
    <AppShell user={user} kiosk subtitle={site.name}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/guard" className="btn-secondary"><Icon icon={ArrowLeft} /> {t("back")}</Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Icon icon={ClipboardList} size={24} /> {t("title")}</h1>
        <p className="muted">{t("context", { gate: device.gate.name, name: user.name })}</p>
      </div>

      {ok ? <p className="alert-ok mb-4" role="status">{ok}</p> : null}
      {errorKey ? <p className="alert-error mb-4" role="alert">{t(errorKey)}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <form action={addShiftLogAction} encType="multipart/form-data" className="card space-y-3 lg:col-span-1">
          <h2 className="text-lg font-semibold">{t("add")}</h2>
          <div>
            <label className="label" htmlFor="kind">{t("kind")}</label>
            <select id="kind" name="kind" className="input" defaultValue="note" required>
              {SHIFT_LOG_KINDS.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="text">{t("text")}</label>
            <textarea id="text" name="text" className="input min-h-28" required maxLength={SHIFT_LOG_TEXT_MAX} placeholder={t("textPlaceholder")} />
          </div>
          <div>
            <label className="label" htmlFor="photo">{t("photo")}</label>
            <input id="photo" name="photo" type="file" accept="image/png,image/jpeg" capture="environment" className="input" disabled={!photosEnabled} />
            <p className="muted mt-1">{photosEnabled ? t("photoHelp") : t("photoDisabled")}</p>
          </div>
          <button type="submit" className="btn-primary w-full">{t("submit")}</button>
        </form>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">{t("today", { count: entries.length })}</h2>
          {entries.length === 0 ? (
            <p className="muted">{t("empty")}</p>
          ) : (
            <ul className="space-y-2" data-testid="shift-log-list">
              {entries.map((e) => (
                <li key={e.id} className="card flex flex-wrap gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${KIND_CLASS[e.kind]}`}>{tk(e.kind)}</span>
                      <span className="font-medium tabular-nums">{fmtDate(e.at, locale, { timeZone: site.timezone, dateStyle: undefined, timeStyle: "short" })}</span>
                      <span className="muted">· {e.guard.name}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{e.text}</p>
                  </div>
                  {e.photoKey ? (
                    <a href={`/api/media/${e.photoKey}`} target="_blank" rel="noreferrer" className="shrink-0" aria-label={t("openPhoto")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- private media served by /api/media, not optimizable */}
                      <img src={`/api/media/${e.photoKey}`} alt="" className="h-20 w-20 rounded-lg border border-border object-cover" />
                      <span className="muted mt-1 flex items-center justify-center gap-1"><Icon icon={Camera} size={14} /> {t("openPhoto")}</span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
