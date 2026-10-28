import { getLocale, getTranslations } from "next-intl/server";
import { Send } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { HostNav } from "@/components/passes/HostNav";
import { WardenEvacuation } from "@/components/evacuation/WardenEvacuation";
import { evacuationSnapshot, requireEvacuationAccess } from "@/lib/server/evacuation";
import { sendEvacuationListAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = { sent?: string; site?: string; error?: string };

/**
 * Fire wardens' evacuation list on the phone: read-only, cached in IndexedDB so it opens without network, with a
 * roll-call mode for drills. Admins and security can push it to the wardens from here.
 */
export default async function WardenEvacuationPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const access = await requireEvacuationAccess("/app/evacuacion");
  const t = await getTranslations("people.evacuation");
  const locale = await getLocale();
  const snapshot = await evacuationSnapshot(access.sites, t("noArea"));
  const sent = sp.sent !== undefined ? Number(sp.sent) : null;

  return (
    <AppShell user={access.user} title={t("title")} subtitle={access.sites.map((s) => s.name).join(" · ")}>
      <HostNav userId={access.user.id} />
      <p className="muted print-hidden mb-4">{t("intro")}</p>
      {sent !== null && Number.isFinite(sent) ? <p className="alert-ok print-hidden mb-4" role="status">{t("sent", { count: sent })}</p> : null}
      {sp.error ? <p className="alert-error print-hidden mb-4" role="alert">{t("sendError")}</p> : null}
      {access.canSend ? (
        <div className="print-hidden mb-4 flex flex-wrap items-center gap-2">
          {access.sites.map((s) => (
            <form key={s.id} action={sendEvacuationListAction}>
              <input type="hidden" name="siteId" value={s.id} />
              <button type="submit" className="btn-primary" data-testid={`send-evacuation-${s.id}`}>
                <Icon icon={Send} /> {t("send")}{access.sites.length > 1 ? ` · ${s.name}` : ""}
              </button>
            </form>
          ))}
          <span className="muted w-full sm:w-auto">{t("sendHelp")}</span>
        </div>
      ) : null}
      <WardenEvacuation initial={snapshot} locale={locale} />
    </AppShell>
  );
}
