import { getTranslations } from "next-intl/server";
import { CalendarPlus, History, UserCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { requireMembership } from "@/lib/auth/guards";

export default async function HostHome() {
  const tenant = await requireMembership("host", "/app");
  const t = await getTranslations();
  const items = [
    { icon: CalendarPlus, label: t("host.invite") },
    { icon: UserCheck, label: t("host.approvals") },
    { icon: History, label: t("host.history") },
  ];
  return (
    <AppShell user={tenant.user} subtitle={tenant.site?.name ?? t("selectPanel.allSites")} title={t("host.title")}>
      <p className="muted mb-6">{t("host.intro")}</p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <li key={i.label} className="card flex items-center gap-3 opacity-70">
            <Icon icon={i.icon} size={22} />
            <div>
              <p className="font-medium">{i.label}</p>
              <p className="muted">{t("app.comingSoon")}</p>
            </div>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
