import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { KioskBar } from "@/components/guard/KioskBar";
import { EvacuationList } from "@/components/guard/EvacuationList";
import { requireKiosk } from "@/lib/auth/kiosk";
import type { EvacuationSnapshot } from "@/lib/offline/queue";
import { evacuationGroups } from "@/lib/server/visits";

export const dynamic = "force-dynamic";

export default async function EvacuationPage() {
  const { user, site, gate } = await requireKiosk();
  const t = await getTranslations("guard.evacuation");
  const locale = await getLocale();
  const { total, groups } = await evacuationGroups(site.id, t("noArea"));
  const snapshot: EvacuationSnapshot = {
    generatedAt: new Date().toISOString(),
    siteName: site.name,
    total,
    groups: groups.map((g) => ({
      area: g.area,
      visits: g.visits.map((v) => ({ id: v.id, visitorName: v.visitorName, company: v.company?.name ?? null, host: v.host?.name ?? null, enteredAt: (v.enteredAt ?? v.createdAt).toISOString(), status: v.status })),
    })),
  };
  return (
    <AppShell user={user} kiosk subtitle={`${site.name} · ${gate.name}`}>
      <KioskBar title={t("title")} />
      <p className="muted print-hidden mb-4">{t("intro")}</p>
      <EvacuationList initial={snapshot} locale={locale} timeZone={site.timezone} />
    </AppShell>
  );
}
