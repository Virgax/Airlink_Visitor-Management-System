import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { requireMembership } from "@/lib/auth/guards";

export default async function ApprovalsPage() {
  const tenant = await requireMembership("approver", "/app/approvals");
  const t = await getTranslations();
  return (
    <AppShell user={tenant.user} subtitle={tenant.site?.name ?? t("selectPanel.allSites")} title={t("host.approvals")}>
      <p className="muted">{t("app.comingSoon")}</p>
    </AppShell>
  );
}
