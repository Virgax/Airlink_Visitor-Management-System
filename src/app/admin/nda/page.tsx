import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { fmtDate } from "@/lib/format";
import { mediaConfigured } from "@/lib/media/putFile";
import { currentNdaId } from "@/lib/server/nda";
import { publishNdaAction } from "./actions";

const ERRORS = ["invalid", "forbidden", "exists", "media", "tooBig", "notPdf"];

/** Visitor policy (NDA) versions: what every visitor accepts from their link before entering, in Spanish and English. */
export default async function NdaAdminPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/nda");
  const t = await getTranslations("admin.ndaPage");
  const tc = await getTranslations("admin.common");
  const locale = await getLocale();
  const isGlobal = tenant.membership.siteId === null;
  const siteIds = tenant.sites.map((s) => s.id);
  const versions = await db.ndaVersion.findMany({
    where: { OR: [{ siteId: null }, { siteId: { in: siteIds } }] },
    include: { site: { select: { name: true, timezone: true } } },
    orderBy: [{ siteId: { sort: "asc", nulls: "first" } }, { activeFrom: "desc" }],
  });
  const current = new Set(await Promise.all(tenant.sites.map((s) => currentNdaId(s.id))));
  const latest = versions.find((v) => v.siteId === null) ?? versions[0] ?? null;
  const major = latest ? Number.parseInt(latest.version, 10) : NaN;
  const suggested = latest ? (Number.isFinite(major) ? `${major + 1}.0` : `${latest.version}.1`) : "1.0";
  const errorKey = sp.error && ERRORS.includes(sp.error) ? sp.error : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {sp.ok === "published" ? <p className="alert-ok" role="status">{t("published")}</p> : null}
      {errorKey ? <p className="alert-error" role="alert">{t(`errors.${errorKey}`)}</p> : null}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t("versions")}</h2>
        {versions.length === 0 ? (
          <p className="muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="nda-versions">
            {versions.map((v) => (
              <li key={v.id} className="py-3" data-testid="nda-version" data-version={v.version}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{v.title}</span>
                  <span className="muted">· v{v.version} · {v.site?.name ?? tc("allSites")}</span>
                  {current.has(v.id) ? <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">{t("current")}</span> : null}
                  {v.bodyEn ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">EN</span> : null}
                  {v.attachmentKey ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">PDF</span> : null}
                </div>
                <p className="muted text-xs">{t("activeFrom")}: {fmtDate(v.activeFrom, locale, { timeZone: v.site?.timezone ?? "America/Santo_Domingo" })}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-sm">{t("showText")}</summary>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div className="whitespace-pre-wrap rounded bg-surface-2 p-3 text-sm">{v.body}</div>
                    {v.bodyEn ? <div className="whitespace-pre-wrap rounded bg-surface-2 p-3 text-sm"><p className="mb-1 font-medium">{v.titleEn ?? v.title}</p>{v.bodyEn}</div> : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">{t("publish")}</h2>
        <p className="muted">{t("publishHelp")}</p>
        <form action={publishNdaAction} className="grid gap-3 md:grid-cols-2" encType="multipart/form-data">
          <div>
            <label className="label" htmlFor="siteId">{t("site")}</label>
            <select id="siteId" name="siteId" className="input" defaultValue={isGlobal ? "" : (tenant.sites[0]?.id ?? "")}>
              {isGlobal ? <option value="">{tc("allSites")}</option> : null}
              {tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="version">{t("version")}</label>
            <input id="version" name="version" required maxLength={20} pattern="[A-Za-z0-9.\-]+" className="input" defaultValue={suggested} />
          </div>
          <div>
            <label className="label" htmlFor="title">{t("titleEs")}</label>
            <input id="title" name="title" required minLength={3} maxLength={120} className="input" defaultValue={latest?.title ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="titleEn">{t("titleEn")}</label>
            <input id="titleEn" name="titleEn" maxLength={120} className="input" defaultValue={latest?.titleEn ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="body">{t("bodyEs")}</label>
            <textarea id="body" name="body" required minLength={20} maxLength={20000} rows={10} className="input" defaultValue={latest?.body ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="bodyEn">{t("bodyEn")}</label>
            <textarea id="bodyEn" name="bodyEn" maxLength={20000} rows={10} className="input" defaultValue={latest?.bodyEn ?? ""} />
            <p className="muted mt-1">{t("bodyEnHelp")}</p>
          </div>
          <div>
            <label className="label" htmlFor="activeFrom">{t("activeFromField")}</label>
            <input id="activeFrom" name="activeFrom" type="datetime-local" className="input" />
            <p className="muted mt-1">{t("activeFromHelp")}</p>
          </div>
          <div>
            <label className="label" htmlFor="attachment">{t("attachment")}</label>
            <input id="attachment" name="attachment" type="file" accept="application/pdf" className="input" disabled={!mediaConfigured()} />
            <p className="muted mt-1">{mediaConfigured() ? t("attachmentHelp") : t("attachmentDisabled")}</p>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary">{t("publishButton")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
