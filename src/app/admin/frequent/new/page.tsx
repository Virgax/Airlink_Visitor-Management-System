import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireMembership } from "@/lib/auth/guards";
import { FREQUENT_ERRORS, FrequentForm } from "../form";

export const dynamic = "force-dynamic";

export default async function NewFrequentPage({ searchParams }: { searchParams: Promise<{ siteId?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/frequent/new");
  const t = await getTranslations("people.frequent");
  const site = tenant.site ?? tenant.sites.find((s) => s.id === sp.siteId) ?? (tenant.sites.length === 1 ? tenant.sites[0] : null) ?? null;
  const error = sp.error && FREQUENT_ERRORS.includes(sp.error) ? sp.error : null;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("newTitle")}</h1>
      {!site ? (
        <div className="card space-y-3">
          <p className="font-medium">{t("form.site")}</p>
          <ul className="flex flex-wrap gap-2">
            {tenant.sites.map((s) => <li key={s.id}><Link href={`/admin/frequent/new?siteId=${s.id}`} className="btn-secondary">{s.name}</Link></li>)}
          </ul>
        </div>
      ) : (
        <FrequentForm tenant={tenant} site={site} existing={null} error={error} />
      )}
    </div>
  );
}
