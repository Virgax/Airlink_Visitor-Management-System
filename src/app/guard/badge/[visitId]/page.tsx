import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { BadgePanel } from "@/components/guard/BadgePanel";
import { KioskBar } from "@/components/guard/KioskBar";
import { requireKiosk } from "@/lib/auth/kiosk";
import { db } from "@/lib/db";
import { kioskBadgeConfig } from "@/lib/server/badges";

export const dynamic = "force-dynamic";

/** Reprint screen reached from the inside list: same panel as the scan step, audited as a reprint. */
export default async function BadgePage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const { user, site, gate } = await requireKiosk();
  const t = await getTranslations("badges.panel");
  const visit = await db.visit.findFirst({ where: { id: visitId, siteId: site.id }, select: { id: true, visitorName: true, status: true } });
  if (!visit || (visit.status !== "inside" && visit.status !== "at_dock" && visit.status !== "left")) notFound();

  return (
    <AppShell user={user} kiosk subtitle={`${site.name} · ${gate.name}`}>
      <KioskBar title={t("reprintTitle")}>
        <span className="muted">{visit.visitorName}</span>
      </KioskBar>
      <div className="mx-auto max-w-3xl">
        <BadgePanel visitId={visit.id} config={kioskBadgeConfig(site, gate)} reprint doneHref="/guard/inside" />
      </div>
    </AppShell>
  );
}
