import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { KioskBar } from "@/components/guard/KioskBar";
import { Scanner } from "@/components/guard/Scanner";
import { requireKiosk } from "@/lib/auth/kiosk";
import { kioskBadgeConfig } from "@/lib/server/badges";

export default async function GuardScanPage() {
  const { user, site, gate } = await requireKiosk();
  const t = await getTranslations("guard.scan");
  const locale = await getLocale();
  return (
    <AppShell user={user} kiosk subtitle={`${site.name} · ${gate.name}`}>
      <KioskBar title={gate.kind === "checkpoint" ? t("checkpointTitle") : t("title")} />
      <p className="muted mb-4">{gate.kind === "checkpoint" ? t("checkpointIntro") : `${t("intro")} ${t("hint")}`}</p>
      <Scanner locale={locale} timeZone={site.timezone} badgeConfig={kioskBadgeConfig(site, gate)} checkpoint={gate.kind === "checkpoint"} />
    </AppShell>
  );
}
