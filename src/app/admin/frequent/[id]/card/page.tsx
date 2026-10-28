import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { getSecret } from "@/lib/secrets";
import { requireReportsTenant } from "@/lib/auth/reports-access";
import { parseSchedule, signStaticQr } from "@/lib/passes/validate";

export const dynamic = "force-dynamic";

/**
 * Printable 85 × 54 mm access card. Paper cannot rotate a QR every 30 seconds, so the card carries a static
 * `signStaticQr` payload whose `exp` is the pass's `validUntil`; the kiosk accepts it like any static QR and the
 * recurring pass keeps its large `maxUses`. Losing the card means deactivating the visitor (revokes the pass).
 */
export default async function FrequentCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireReportsTenant(`/admin/frequent/${id}/card`);
  const t = await getTranslations("people.frequent");
  const tk = await getTranslations("passes");
  const locale = await getLocale();
  const visitor = await db.frequentVisitor.findFirst({
    where: { id, ...tenant.siteFilter },
    include: { company: { select: { name: true } }, pass: true, site: { select: { id: true, name: true, timezone: true } } },
  });
  if (!visitor) notFound();
  const pass = visitor.pass && visitor.pass.status === "active" && visitor.pass.validUntil > new Date() ? visitor.pass : null;
  const schedule = parseSchedule(pass?.schedule);
  const payload = pass && visitor.signIn === "qr_card" ? signStaticQr({ passId: pass.id, exp: Math.floor(pass.validUntil.getTime() / 1000), siteId: pass.siteId }, await getSecret("PASS_SIGNING_KEY")) : null;
  const qr = payload ? await QRCode.toDataURL(payload, { margin: 0, width: 260, errorCorrectionLevel: "M" }) : null;

  return (
    <div className="access-card-page space-y-4">
      <div className="print-hidden flex flex-wrap items-center gap-3">
        <Link href="/admin/frequent" className="btn-secondary px-2 py-2" aria-label={t("title")}><Icon icon={ArrowLeft} /></Link>
        <h1 className="text-2xl font-semibold">{t("cardTitle")} · {visitor.name}</h1>
        <PrintButton label={t("cardPrint")} className="btn-primary ml-auto" />
      </div>
      <p className="muted print-hidden max-w-3xl">{t("cardHelp")}</p>
      {!pass ? <p className="alert-error print-hidden" role="alert">{t("cardNoPass")}</p> : null}
      {pass && visitor.signIn === "pin" ? <p className="muted print-hidden">{t("cardPinOnly")}</p> : null}

      <div className="access-card-sheet">
        <div className="access-card" data-testid="access-card">
          <div className="flex min-w-0 flex-col justify-between">
            <div className="flex items-center gap-2">
              <Logo className="h-5 w-auto" />
              <span className="text-[10px] uppercase tracking-wide text-neutral-600">{visitor.site.name}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight">{visitor.name}</p>
              {visitor.company ? <p className="truncate text-xs text-neutral-700">{visitor.company.name}</p> : null}
              {visitor.docLast4 ? <p className="text-[10px] text-neutral-600">{t("docEnding", { last4: visitor.docLast4 })}</p> : null}
            </div>
            <div className="text-[9px] leading-tight text-neutral-700">
              {schedule ? <p>{t("cardSchedule", { days: schedule.days.map((d) => tk(`weekdays.${d}`)).join(" "), from: schedule.from, to: schedule.to })}</p> : null}
              {pass ? <p>{t("cardValid", { date: fmtDate(pass.validUntil, locale, { timeZone: visitor.site.timezone, dateStyle: "medium", timeStyle: undefined }) })}</p> : null}
            </div>
          </div>
          <div className="flex items-center justify-center">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated server side
              <img src={qr} alt="QR" className="access-card-qr" data-testid="card-qr" />
            ) : (
              <div className="access-card-qr flex items-center justify-center rounded border border-dashed border-neutral-400 text-center text-[9px] text-neutral-500">{visitor.signIn === "pin" ? t("signIn.pin") : "—"}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
