import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Icon } from "@/components/Icon";
import { FormEditor } from "@/components/forms/FormEditor";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { parseFormElements } from "@/lib/forms/schema";
import { canEditTemplate, templateWhereForTenant } from "@/lib/server/forms";
import { saveTemplateAction, uploadFormMediaAction } from "../actions";

export default async function FormEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await requireMembership("admin", `/admin/forms/${id}`);
  const t = await getTranslations("forms.editor");
  const tc = await getTranslations("admin.common");
  const tk = await getTranslations("admin.kinds");
  const template = await db.formTemplate.findFirst({
    where: { id, ...templateWhereForTenant(tenant) },
    include: { site: { select: { name: true } }, policies: { select: { kind: true, site: { select: { name: true } } } } },
  });
  if (!template) notFound();
  const editable = canEditTemplate(tenant, template);
  const elements = parseFormElements(template.elements) ?? [];
  const okKey = sp.ok && ["saved", "created", "duplicated"].includes(sp.ok) ? sp.ok : null;
  const usedBy = template.policies.map((p) => `${tk(p.kind)} (${p.site.name})`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{template.name}</h1>
          <p className="muted">{template.site?.name ?? t("allSites")} · {t("usedBy")}: {usedBy.length ? usedBy.join(", ") : t("usedByNone")}</p>
        </div>
        <Link href="/admin/forms" className="btn-secondary text-sm"><Icon icon={ArrowLeft} /> {t("back")}</Link>
      </div>
      {okKey ? <p className="alert-ok" role="status">{t(`ok.${okKey}`)}</p> : null}
      {sp.error ? <p className="alert-error" role="alert">{tc("invalid")}</p> : null}
      {!editable ? <p className="alert-error border-warning/30 bg-warning-bg text-warning">{t("readOnly")}</p> : null}
      <FormEditor template={{ id: template.id, name: template.name, elements }} readOnly={!editable} save={saveTemplateAction} upload={uploadFormMediaAction} />
    </div>
  );
}
