import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PushSubscribeButton } from "@/components/PushSubscribeButton";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { parsePrefs } from "@/lib/notifications/types";
import { savePrefsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationPrefsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/notifications");
  const t = await getTranslations("notifications");
  const pref = await db.notificationPref.findUnique({ where: { userId: user.id } });
  const prefs = parsePrefs(pref?.prefs);
  const ok = sp.ok === "saved" ? t("prefs.saved") : null;
  const error = sp.error === "invalid" ? t("prefs.invalid") : null;

  return (
    <AppShell user={user} title={t("prefs.title")}>
      <p className="muted mb-4">{t("prefs.intro")}</p>
      {ok ? <p className="alert-ok mb-4" role="status">{ok}</p> : null}
      {error ? <p className="alert-error mb-4" role="alert">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={savePrefsAction} className="card space-y-4">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{t("prefs.quietTitle")}</h2>
            <p className="muted">{t("prefs.quietHelp")}</p>
            <p className="muted" data-testid="quiet-summary">
              {pref?.quietFrom && pref?.quietTo ? t("prefs.quietActive", { from: pref.quietFrom, to: pref.quietTo }) : t("prefs.quietNone")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="quietFrom">{t("prefs.quietFrom")}</label>
                <input id="quietFrom" name="quietFrom" type="time" defaultValue={pref?.quietFrom ?? ""} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="quietTo">{t("prefs.quietTo")}</label>
                <input id="quietTo" name="quietTo" type="time" defaultValue={pref?.quietTo ?? ""} className="input" />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{t("prefs.emailTitle")}</h2>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="emailFallback" defaultChecked={prefs.emailFallback === true} className="mt-1" />
              <span>{t("prefs.emailFallback")}</span>
            </label>
          </div>
          <button type="submit" className="btn-primary">{t("prefs.save")}</button>
        </form>

        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">{t("push.title")}</h2>
          <p className="muted">{t("push.help")}</p>
          <PushSubscribeButton />
        </section>
      </div>

      <p className="mt-6">
        <Link href="/account" className="btn-secondary text-sm"><Icon icon={ArrowLeft} /> {t("prefs.back")}</Link>
      </p>
    </AppShell>
  );
}
