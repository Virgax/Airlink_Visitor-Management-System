import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Copy, Pencil, Plus, Power } from "lucide-react";
import { Icon } from "@/components/Icon";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { parseFormElements } from "@/lib/forms/schema";
import { canEditTemplate, templateWhereForTenant } from "@/lib/server/forms";
import { listManagedSites } from "@/lib/server/sites";
import { createTemplateAction, duplicateTemplateAction, renameTemplateAction, toggleTemplateAction } from "./actions";

const OKS = ["created", "duplicated", "renamed", "activated", "deactivated", "saved"];

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/forms");
  const t = await getTranslations("forms.list");
  const tk = await getTranslations("admin.kinds");
  const tc = await getTranslations("admin.common");
  const sites = (await listManagedSites(tenant)).filter((s) => s.active);
  const templates = await db.formTemplate.findMany({
    where: templateWhereForTenant(tenant),
    include: { site: { select: { id: true, name: true } }, policies: { select: { kind: true, site: { select: { id: true, name: true } } } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const okKey = sp.ok && OKS.includes(sp.ok) ? sp.ok : null;
  const errorKey = sp.error === "forbidden" ? "forbidden" : sp.error ? "invalid" : null;
  const canShare = tenant.membership.siteId === null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="muted mt-1">{t("intro")}</p>
      </div>
      {okKey ? <p className="alert-ok" role="status">{t(`ok.${okKey}`)}</p> : null}
      {errorKey ? <p className="alert-error" role="alert">{errorKey === "forbidden" ? t("errors.forbidden") : tc("invalid")}</p> : null}

      <form action={createTemplateAction} className="card grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="new-name">{t("name")}</label>
          <input id="new-name" name="name" required minLength={2} maxLength={80} className="input" placeholder={t("namePlaceholder")} />
        </div>
        <div>
          <label className="label" htmlFor="new-site">{t("site")}</label>
          <select id="new-site" name="siteId" className="input" defaultValue={canShare ? "" : (tenant.site?.id ?? sites[0]?.id ?? "")}>
            {canShare ? <option value="">{t("allSites")}</option> : null}
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-primary"><Icon icon={Plus} /> {t("create")}</button>
      </form>

      {templates.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3" data-testid="form-templates">
          {templates.map((tpl) => {
            const elements = parseFormElements(tpl.elements) ?? [];
            const editable = canEditTemplate(tenant, tpl);
            const usedBy = tpl.policies.map((p) => (sites.length > 1 || !tpl.siteId ? `${tk(p.kind)} (${p.site.name})` : tk(p.kind)));
            return (
              <li key={tpl.id} className={`card space-y-3 ${tpl.active ? "" : "opacity-70"}`} data-testid="form-template" data-active={tpl.active}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">
                      <Link href={`/admin/forms/${tpl.id}`} className="underline-offset-2 hover:underline">{tpl.name}</Link>
                      {!tpl.active ? <span className="muted ml-2 text-sm font-normal">({t("inactive")})</span> : null}
                    </h2>
                    <p className="muted">
                      {tpl.site?.name ?? t("allSites")} · {t("elements", { count: elements.length })}
                    </p>
                    <p className="muted" data-testid="used-by">{t("usedBy")}: {usedBy.length ? usedBy.join(", ") : t("usedByNone")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/forms/${tpl.id}`} className="btn-secondary text-sm"><Icon icon={Pencil} /> {editable ? t("edit") : t("view")}</Link>
                    <form action={duplicateTemplateAction}>
                      <input type="hidden" name="id" value={tpl.id} />
                      <button type="submit" className="btn-secondary text-sm"><Icon icon={Copy} /> {t("duplicate")}</button>
                    </form>
                    {editable ? (
                      <form action={toggleTemplateAction}>
                        <input type="hidden" name="id" value={tpl.id} />
                        <button type="submit" className="btn-secondary text-sm"><Icon icon={Power} /> {tpl.active ? t("deactivate") : t("activate")}</button>
                      </form>
                    ) : null}
                  </div>
                </div>
                {editable ? (
                  <form action={renameTemplateAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={tpl.id} />
                    <div className="min-w-0 flex-1">
                      <label className="label" htmlFor={`rename-${tpl.id}`}>{t("rename")}</label>
                      <input id={`rename-${tpl.id}`} name="name" required minLength={2} maxLength={80} className="input" defaultValue={tpl.name} />
                    </div>
                    <button type="submit" className="btn-secondary text-sm">{t("save")}</button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
