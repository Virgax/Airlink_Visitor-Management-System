import { getTranslations } from "next-intl/server";
import { Building2, ShieldCheck, Siren, UserCheck, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { listPanels, requireUser } from "@/lib/auth/guards";
import { openPanelAction } from "./actions";

const ICONS = { admin: Building2, security: ShieldCheck, approver: UserCheck, host: Users, warden: Siren } as const;

export default async function SelectPanelPage() {
  const user = await requireUser("/select-panel");
  const t = await getTranslations();
  const panels = await listPanels(user);

  return (
    <AppShell user={user} title={t("selectPanel.title")}>
      <p className="muted mb-6">{t("home.welcome", { name: user.name })} · {t("selectPanel.subtitle")}</p>
      {panels.length === 0 ? (
        <p className="alert-error">{t("selectPanel.empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {panels.map((p) => (
            <li key={`${p.role}-${p.siteId ?? "all"}`} className="card flex items-center gap-3">
              <span className="rounded-lg bg-surface-2 p-2"><Icon icon={ICONS[p.role]} size={22} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`roles.${p.role}`)}</p>
                <p className="muted truncate">{p.siteName ?? t("selectPanel.allSites")}</p>
              </div>
              <form action={openPanelAction}>
                <input type="hidden" name="href" value={p.href} />
                <input type="hidden" name="siteId" value={p.siteId ?? ""} />
                <button type="submit" className="btn-primary">{t("selectPanel.open")}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
