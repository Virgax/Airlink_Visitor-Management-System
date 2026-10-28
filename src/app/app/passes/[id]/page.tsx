import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Ban, Copy, KeyRound, Mail, Pencil } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { HostNav } from "@/components/passes/HostNav";
import { PassStatusBadge } from "@/components/passes/PassStatusBadge";
import { ShareLink } from "@/components/passes/ShareLink";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { requireMembership } from "@/lib/auth/guards";
import { ownPassWhere } from "@/lib/server/host-passes";
import { loadPolicy } from "@/lib/server/passes";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import { parseSchedule } from "@/lib/passes/validate";
import { readPinFlash } from "@/lib/server/invites";
import { emailPassAction, renamePassAction, revokePassAction } from "../actions";
import { formatAnswer, listAnswers, readAnswers } from "@/lib/forms/schema";

type Search = { ok?: string; error?: string };

export default async function PassDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await requireMembership("host", `/app/passes/${id}`);
  const pass = await db.pass.findFirst({
    where: { id, ...ownPassWhere(tenant) },
    include: {
      site: { select: { name: true, timezone: true } },
      company: { select: { name: true } },
      host: { select: { name: true } },
      escort: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  if (!pass) notFound();
  const t = await getTranslations("host.detail");
  const tk = await getTranslations("passes");
  const tr = await getTranslations("roles");
  const ts = await getTranslations("selectPanel");
  const locale = await getLocale();
  const tz = pass.site.timezone;
  const [areas, gates, group, policy] = await Promise.all([
    pass.areaIds.length ? db.area.findMany({ where: { id: { in: pass.areaIds } }, select: { name: true } }) : [],
    pass.gateIds.length ? db.gate.findMany({ where: { id: { in: pass.gateIds } }, select: { name: true } }) : [],
    pass.groupId ? db.pass.findMany({ where: { groupId: pass.groupId, ...ownPassWhere(tenant) }, select: { id: true, visitorName: true, status: true }, orderBy: { createdAt: "asc" } }) : [],
    loadPolicy(pass.siteId, pass.kind),
  ]);
  const evaluation = evaluatePolicy(policy, { kind: pass.kind });
  const requiresNda = evaluation.warnings.includes("nda");
  const url = `${env().APP_URL.replace(/\/$/, "")}/v/${pass.token}`;
  const schedule = parseSchedule(pass.schedule);
  const canRevoke = pass.status === "active" || pass.status === "pending_approval";
  const okKey = sp.ok && ["created", "createdGroup", "revoked", "renamed", "emailed"].includes(sp.ok) ? sp.ok : null;
  const date = (d: Date) => fmtDate(d, locale, { timeZone: tz });
  const tp = await getTranslations("people");
  const flashPin = pass.pinHash ? await readPinFlash(pass.id) : null;
  const emailError = sp.error?.startsWith("email_") ? sp.error.slice("email_".length) : null;
  const emailErrorKey = emailError && ["invalid", "not_open", "email_not_configured", "failed", "rateLimited"].includes(emailError) ? emailError : emailError ? "failed" : null;
  const canEmail = (pass.status === "active" || pass.status === "pending_approval") && pass.validUntil > new Date();
  const tf = await getTranslations("forms.answers");
  const answers = listAnswers(readAnswers(pass.extra));

  return (
    <AppShell user={tenant.user} subtitle={tenant.site?.name ?? ts("allSites")} title={t("title", { name: pass.visitorName })}>
      <HostNav userId={tenant.user.id} />
      {okKey ? <p className="alert-ok mb-4" role="status">{t(`ok.${okKey}`, { count: group.length })}</p> : null}
      {sp.error && !emailErrorKey ? <p className="alert-error mb-4" role="alert">{t("errors.invalid")}</p> : null}
      {emailErrorKey ? <p className="alert-error mb-4" role="alert">{tp(`email.errors.${emailErrorKey as "failed"}`)}</p> : null}
      {flashPin ? (
        <div className="alert-ok mb-4 flex flex-wrap items-center gap-3" role="status" data-testid="pass-pin">
          <Icon icon={KeyRound} />
          <span className="font-medium">{tp("pin.title")}:</span>
          <span className="font-mono text-2xl tracking-widest" data-testid="pass-pin-value">{flashPin}</span>
          <span className="w-full text-xs sm:w-auto">{tp("pin.shownOnce")}</span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <PassStatusBadge status={pass.status} />
            <span className="muted">{tk(`kinds.${pass.kind}.label`)}</span>
            <span className="muted">· {t("created", { date: date(pass.createdAt) })}</span>
          </div>
          {pass.status === "pending_approval" ? <p className="alert-error border-warning/30 bg-warning-bg text-warning">{t("pendingNotice", { role: tr(evaluation.approverRole ?? "security") })}</p> : null}
          {pass.approvedBy && pass.approvedAt && pass.status === "active" ? <p className="muted">{t("approvedBy", { name: pass.approvedBy.name, date: date(pass.approvedAt) })}</p> : null}
          {pass.approvedBy && pass.approvedAt && pass.status === "denied" ? <p className="muted">{t("deniedBy", { name: pass.approvedBy.name, date: date(pass.approvedAt) })}</p> : null}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="muted">{t("site")}</dt><dd>{pass.site.name}</dd>
            <dt className="muted">{t("host")}</dt><dd>{pass.host.name}</dd>
            <dt className="muted">{t("company")}</dt><dd>{pass.company?.name ?? "—"}</dd>
            <dt className="muted">{t("contact")}</dt><dd>{[pass.visitorPhone, pass.visitorEmail].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="muted">{t("doc")}</dt><dd>{pass.visitorDocLast4 ? t("docEnding", { last4: pass.visitorDocLast4 }) : t("docMissing")}</dd>
            <dt className="muted">{t("plate")}</dt><dd>{pass.plate ?? "—"}</dd>
            <dt className="muted">{t("window")}</dt><dd>{date(pass.validFrom)} → {date(pass.validUntil)}</dd>
            {schedule ? (
              <>
                <dt className="muted">{t("schedule")}</dt>
                <dd>{schedule.days.map((d) => tk(`weekdays.${d}`)).join(" ")} · {schedule.from}–{schedule.to}</dd>
              </>
            ) : null}
            <dt className="muted">{t("areas")}</dt><dd>{areas.map((a) => a.name).join(", ") || "—"}</dd>
            <dt className="muted">{t("gates")}</dt><dd>{gates.map((g) => g.name).join(", ") || t("anyGate")}</dd>
            <dt className="muted">{t("escort")}</dt><dd>{pass.escort?.name ?? "—"}</dd>
            <dt className="muted">{t("nda")}</dt>
            <dd>{!requiresNda ? t("ndaNotRequired") : pass.ndaAcceptedAt ? t("ndaAccepted", { date: date(pass.ndaAcceptedAt), version: pass.ndaVersion ?? "" }) : t("ndaPending")}</dd>
            {pass.note ? <><dt className="muted">{t("note")}</dt><dd className="whitespace-pre-wrap">{pass.note}</dd></> : null}
            {pass.pinHash ? <><dt className="muted">{tp("pin.title")}</dt><dd>{tp("pin.has")}</dd></> : null}
            <dd className="muted col-span-2">{t("uses", { uses: pass.uses, max: pass.maxUses })}</dd>
          </dl>

          {answers.length ? (
            <div data-testid="pass-answers">
              <h2 className="mb-1 font-medium">{tf("title")}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {answers.map((a) => (
                  <div key={a.id} className="contents" data-answer={a.id}>
                    <dt className="muted">{a.label}</dt>
                    <dd>{formatAnswer(a.value, { yes: tf("yes"), no: tf("no") })}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {group.length > 1 ? (
            <div>
              <h2 className="mb-1 font-medium">{t("group")} · {t("groupMembers", { count: group.length })}</h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {group.map((g) => (
                  <li key={g.id}>
                    <Link href={`/app/passes/${g.id}`} className={`btn-secondary px-3 py-1 text-xs ${g.id === pass.id ? "ring-2 ring-ring" : ""}`}>{g.visitorName}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="card space-y-3">
            <h2 className="font-medium">{t("link")}</h2>
            <p className="muted">{t("linkHelp")}</p>
            <ShareLink url={url} title={`${t("title", { name: pass.visitorName })} · ${pass.site.name}`} labels={{ copy: t("copy"), copied: t("copied"), share: t("share"), open: t("open") }} />
          </section>
          {canEmail ? (
            <section className="card space-y-3">
              <h2 className="font-medium"><Icon icon={Mail} /> {tp("email.title")}</h2>
              <p className="muted">{tp("email.help")}{flashPin ? ` ${tp("email.includesPin")}` : ""}</p>
              <form action={emailPassAction} className="space-y-2">
                <input type="hidden" name="passId" value={pass.id} />
                <label className="label" htmlFor="inviteEmail">{tp("email.to")}</label>
                <div className="flex gap-2">
                  <input id="inviteEmail" name="email" type="email" required maxLength={200} className="input" defaultValue={pass.visitorEmail ?? ""} autoComplete="off" />
                  <button type="submit" className="btn-secondary whitespace-nowrap">{tp("email.send")}</button>
                </div>
              </form>
            </section>
          ) : null}
          <section className="card space-y-3">
            <form action={renamePassAction} className="space-y-2">
              <input type="hidden" name="passId" value={pass.id} />
              <label className="label" htmlFor="visitorName">{t("name")}</label>
              <div className="flex gap-2">
                <input id="visitorName" name="visitorName" required minLength={2} maxLength={120} className="input" defaultValue={pass.visitorName} />
                <button type="submit" className="btn-secondary" title={t("rename")}><Icon icon={Pencil} /> <span className="sr-only sm:not-sr-only">{t("save")}</span></button>
              </div>
            </form>
            <div className="flex flex-wrap gap-2">
              <Link href={`/app/passes/new?siteId=${pass.siteId}&from=${pass.id}`} className="btn-secondary"><Icon icon={Copy} /> {t("duplicate")}</Link>
              {canRevoke ? (
                <form action={revokePassAction}>
                  <input type="hidden" name="passId" value={pass.id} />
                  <button type="submit" className="btn-secondary text-danger"><Icon icon={Ban} /> {t("revoke")}</button>
                </form>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
