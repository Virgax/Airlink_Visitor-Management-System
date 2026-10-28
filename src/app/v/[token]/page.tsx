import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/auth/session";
import { Logo } from "@/components/Logo";
import { RotatingQr } from "@/components/passes/RotatingQr";
import { qrPayloadFor } from "@/lib/server/passes";
import { loadPolicyAndForm } from "@/lib/server/forms";
import { evaluatePolicy, missingDoc } from "@/lib/policies/evaluate";
import { parseSchedule } from "@/lib/passes/validate";
import { isOpenForVisitor, TOKEN_RE } from "@/lib/passes/visitor";
import { FormFields } from "@/components/forms/FormFields";
import { formLabels } from "@/lib/forms/labels";
import { builtinMode, elementsFor, hasAnswer, readAnswers, type BuiltinElement } from "@/lib/forms/schema";
import { acceptNdaAction, preregisterAction } from "./actions";

export const dynamic = "force-dynamic";
type Search = { ok?: string; error?: string };

/** Active NDA for a site: the site-specific one if any, else the global one; latest activeFrom wins. */
async function activeNda(siteId: string) {
  const rows = await db.ndaVersion.findMany({ where: { OR: [{ siteId }, { siteId: null }], activeFrom: { lte: new Date() } }, orderBy: { activeFrom: "desc" } });
  return rows.find((n) => n.siteId === siteId) ?? rows[0] ?? null;
}

/** Public pass page. Shows only what the visitor needs; never the host's contact details. */
export default async function VisitorPassPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!TOKEN_RE.test(token)) notFound();
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`pass-view:ip:${ip}`, 60, 60);
  if (!limit.ok) notFound();

  const pass = await db.pass.findUnique({
    where: { token },
    include: { site: { select: { id: true, name: true, address: true, timezone: true, settings: true } }, host: { select: { name: true, department: true } }, company: { select: { name: true } } },
  });
  if (!pass) notFound();
  const t = await getTranslations("visitor");
  const tp = await getTranslations("passes");
  const locale = await getLocale();
  const tz = pass.site.timezone;
  const now = new Date();
  const open = isOpenForVisitor(pass, now);
  const { policy, form } = await loadPolicyAndForm(pass.siteId, pass.kind);
  const answers = readAnswers(pass.extra);
  const evaluation = evaluatePolicy(policy, {
    kind: pass.kind,
    visitorDocHash: pass.visitorDocHash,
    plate: pass.plate,
    form: form.elements,
    surface: "visitor",
    answers,
    visitorPhone: pass.visitorPhone,
    visitorEmail: pass.visitorEmail,
    company: pass.companyId,
    ndaAcceptedAt: pass.ndaAcceptedAt,
  });
  const needsDoc = missingDoc(evaluation, form.elements);
  const needsNda = evaluation.warnings.includes("nda") && !pass.ndaAcceptedAt;
  const visitorElements = elementsFor(form.elements, "visitor");
  const mode = (type: BuiltinElement["type"]) => builtinMode(form.elements, type, "visitor");
  const signatureElement = visitorElements.find((e) => e.type === "signature") ?? null;
  const questions = visitorElements.filter((e) => e.type === "question");
  const unansweredQuestions = questions.some((e) => !hasAnswer(answers[e.id]?.value));
  const hasVisitorBlocks = visitorElements.some((e) => e.type === "text" || e.type === "media");
  const showPrereg = open && (needsDoc || (mode("document") !== "off" && !pass.visitorDocHash) || (mode("phone") !== "off" && !pass.visitorPhone) || unansweredQuestions || hasVisitorBlocks);
  const nda = open && needsNda ? await activeNda(pass.siteId) : null;
  const labels = await formLabels();
  const mediaHref = (key: string) => `/api/media/${key}?pass=${encodeURIComponent(token)}`;
  const schedule = parseSchedule(pass.schedule);
  const showQr = pass.status === "active" && pass.validUntil > now;
  const qr = showQr ? await qrPayloadFor(pass, now) : null;
  const dataUrl = qr ? await QRCode.toDataURL(qr.payload, { margin: 1, width: 288, errorCorrectionLevel: "M" }) : null;
  const instructions = typeof pass.site.settings === "object" && pass.site.settings && "arrivalInstructions" in pass.site.settings ? String((pass.site.settings as Record<string, unknown>).arrivalInstructions ?? "") : "";
  const okKey = sp.ok === "prereg" ? "prereg" : sp.ok === "nda" ? "nda" : null;
  const errorKey = sp.error && ["invalid", "rateLimited", "closed", "missing"].includes(sp.error) ? sp.error : null;
  const statusClass = pass.status === "active" ? "bg-success-bg text-success" : pass.status === "pending_approval" ? "bg-warning-bg text-warning" : "bg-danger-bg text-danger";

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-8">
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-auto" />
          <span className="border-l border-border pl-3 text-text-muted">Visitas</span>
        </div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-xl">{pass.visitorName}{pass.company ? <span className="muted"> · {pass.company.name}</span> : null}</p>
        <p className={`rounded-lg px-3 py-2 text-sm ${statusClass}`} data-testid="pass-status" data-status={pass.status}>{tp(`status.${pass.status}`)}</p>
        {okKey ? <p className="alert-ok" role="status">{t(`${okKey}.ok`)}</p> : null}
        {errorKey ? <p className="alert-error" role="alert">{t(`errors.${errorKey}`)}</p> : null}

        {qr && dataUrl ? (
          <section className="space-y-2 text-center">
            {qr.rotating ? (
              <RotatingQr token={token} initial={{ dataUrl, refreshInSec: qr.refreshInSec ?? 30 }} labels={{ alt: t("qr.alt"), loading: t("qr.loading"), offline: t("qr.offline") }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated server side
              <img src={dataUrl} alt={t("qr.alt")} width={288} height={288} className="mx-auto rounded-lg bg-white p-2" data-testid="pass-qr" />
            )}
            <p className="muted">{t("qr.help")}</p>
            {qr.rotating ? <p className="muted">{t("qr.rotating")}</p> : null}
          </section>
        ) : pass.status === "pending_approval" ? (
          <p className="muted">{t("qr.pending")}</p>
        ) : (
          <p className="muted">{t("qr.unavailable")}</p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="muted">{t("site")}</dt><dd>{pass.site.name}{pass.site.address ? ` · ${pass.site.address}` : ""}</dd>
          <dt className="muted">{t("host")}</dt><dd>{pass.host.name}{pass.host.department ? ` · ${pass.host.department}` : ""}</dd>
          <dt className="muted">{t("from")}</dt><dd>{fmtDate(pass.validFrom, locale, { timeZone: tz })}</dd>
          <dt className="muted">{t("until")}</dt><dd>{fmtDate(pass.validUntil, locale, { timeZone: tz })}</dd>
          {schedule ? <><dt className="muted">{t("schedule")}</dt><dd>{schedule.days.map((d) => tp(`weekdays.${d}`)).join(" ")} · {schedule.from}–{schedule.to}</dd></> : null}
        </dl>
        <p className="muted">{t("instructions")}</p>
        {instructions ? <p className="muted whitespace-pre-wrap">{instructions}</p> : null}
        {pass.visitorDocLast4 ? <p className="muted">{t("prereg.docSaved", { last4: pass.visitorDocLast4 })}</p> : null}

        {showPrereg ? (
          <form action={preregisterAction} className="space-y-3 rounded-lg border border-border p-3">
            <input type="hidden" name="token" value={token} />
            <h2 className="font-medium">{t("prereg.title")}</h2>
            <p className="muted">{t("prereg.intro")}</p>
            <FormFields
              elements={form.elements}
              surface="visitor"
              labels={labels}
              answers={answers}
              mediaHref={mediaHref}
              exclude={["signature"]}
              renderBuiltin={(e) => {
                const required = e.mode === "required";
                switch (e.type) {
                  case "document":
                    return pass.visitorDocHash ? null : (
                      <div>
                        <label className="label" htmlFor="doc">{e.label || t("prereg.doc")}</label>
                        <input id="doc" name="doc" required={required} minLength={5} maxLength={40} className="input" autoComplete="off" inputMode="text" />
                        {e.help ? <p className="muted mt-1">{e.help}</p> : null}
                      </div>
                    );
                  case "phone":
                    return (
                      <div>
                        <label className="label" htmlFor="phone">{e.label || t("prereg.phone")}</label>
                        <input id="phone" name="phone" type="tel" maxLength={40} className="input" defaultValue={pass.visitorPhone ?? ""} autoComplete="tel" required={required && !pass.visitorPhone} />
                      </div>
                    );
                  case "email":
                    return (
                      <div>
                        <label className="label" htmlFor="email">{e.label || t("prereg.email")}</label>
                        <input id="email" name="email" type="email" maxLength={200} className="input" defaultValue={pass.visitorEmail ?? ""} autoComplete="email" required={required && !pass.visitorEmail} />
                      </div>
                    );
                  case "plate":
                    return (
                      <div>
                        <label className="label" htmlFor="plate">{e.label || t("prereg.plate")}</label>
                        <input id="plate" name="plate" maxLength={20} className="input" defaultValue={pass.plate ?? ""} required={required && !pass.plate} />
                      </div>
                    );
                  case "company":
                    return pass.companyId ? null : (
                      <div>
                        <label className="label" htmlFor="company">{e.label || t("prereg.company")}</label>
                        <input id="company" name="company" maxLength={120} className="input" autoComplete="organization" required={required} />
                      </div>
                    );
                  default:
                    return null;
                }
              }}
            />
            <button type="submit" className="btn-primary w-full">{t("prereg.submit")}</button>
          </form>
        ) : null}

        {nda ? (
          <form action={acceptNdaAction} className="space-y-3 rounded-lg border border-border p-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="ndaId" value={nda.id} />
            <h2 className="font-medium">{t("nda.title")}</h2>
            <p className="muted">{t("nda.intro")}</p>
            <h3 className="text-sm font-medium">{nda.title} · v{nda.version}</h3>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-surface-2 p-3 text-sm">{nda.body}</div>
            {nda.attachmentKey ? <a href={mediaHref(nda.attachmentKey)} target="_blank" rel="noreferrer" className="btn-secondary inline-flex text-sm">{t("nda.attachment")}</a> : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="accept" required className="mt-1" /> {t("nda.accept")}
            </label>
            {signatureElement ? (
              <FormFields elements={[signatureElement]} surface="visitor" labels={labels} />
            ) : (
              <div>
                <label className="label" htmlFor="name">{t("nda.name")}</label>
                <input id="name" name="name" required minLength={3} maxLength={120} className="input" autoComplete="name" />
              </div>
            )}
            <button type="submit" className="btn-primary w-full">{t("nda.submit")}</button>
          </form>
        ) : null}
        {pass.ndaAcceptedAt ? <p className="muted">{t("nda.accepted", { date: fmtDate(pass.ndaAcceptedAt, locale, { timeZone: tz }) })}</p> : null}

        <p className="muted text-xs">{t("privacy")} <Link href="/legal/privacidad" className="underline">/legal/privacidad</Link></p>
      </div>
    </main>
  );
}
