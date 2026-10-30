import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { getSessionUser } from "@/lib/auth/session";
import { HELP_AUDIENCES, HELP_GUIDES } from "@/lib/help/guides";
import { HELP_ICONS } from "@/lib/help/icons";

/** Public help index: operational documentation only (no personal data; screenshots come from a demo database). */
export default async function HelpIndexPage() {
  const user = await getSessionUser();
  const t = await getTranslations("help");
  return (
    <AppShell user={user && !user.guardDeviceId ? user : null} kiosk={!!user?.guardDeviceId} title={t("title")}>
      <p className="muted mb-6 max-w-3xl">{t("intro")}</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="help-guides">
        {HELP_GUIDES.map((g) => (
          <li key={g.slug} className="card flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-surface-2 p-2"><Icon icon={HELP_ICONS[g.icon]} size={22} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">
                  <Link href={`/help/${g.slug}`} className="hover:underline">{t(`guides.${g.slug}.title`)}</Link>
                </h2>
                <p className="muted mt-1 text-sm">{t(`guides.${g.slug}.summary`)}</p>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              {t("forLabel")}: {HELP_AUDIENCES.filter((a) => g.audience.includes(a)).map((a) => t(`audiences.${a}`)).join(" · ")} · {t("stepsCount", { count: g.steps.length })}
            </p>
            <Link href={`/help/${g.slug}`} className="btn-secondary mt-auto self-start text-sm">{t("open")}</Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
