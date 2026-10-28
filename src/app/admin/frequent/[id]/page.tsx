import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/auth/guards";
import { FREQUENT_ERRORS, FrequentForm } from "../form";

export const dynamic = "force-dynamic";

export default async function EditFrequentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await requireMembership("admin", `/admin/frequent/${id}`);
  const t = await getTranslations("people.frequent");
  const existing = await db.frequentVisitor.findFirst({ where: { id, ...tenant.siteFilter }, include: { company: { select: { name: true } }, pass: true, site: { select: { id: true, name: true, timezone: true } } } });
  if (!existing) notFound();
  const error = sp.error && FREQUENT_ERRORS.includes(sp.error) ? sp.error : null;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("editTitle", { name: existing.name })}</h1>
      <FrequentForm tenant={tenant} site={existing.site} existing={existing} error={error} />
    </div>
  );
}
