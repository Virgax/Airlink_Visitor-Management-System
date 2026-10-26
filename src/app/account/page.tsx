import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BellRing } from "lucide-react";
import { Icon } from "@/components/Icon";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { totpUri } from "@/lib/auth/totp";
import { changePasswordAction, pendingTotpSecret, setPinAction, totpConfirmAction, totpStartAction } from "./actions";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; totp?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account");
  const t = await getTranslations("account");
  const tn = await getTranslations("notifications.prefs");
  const full = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, totpSecret: true, pinHash: true, memberships: { select: { role: true } } } });
  const isSecurity = full.memberships.some((m) => m.role === "security");
  const pending = sp.totp === "setup" ? await pendingTotpSecret() : null;

  const ok = sp.ok === "password" ? t("password.ok") : sp.ok === "pin" ? t("pin.ok") : sp.ok === "totp" ? t("totp.ok") : null;
  const error =
    sp.error === "weak" ? t("password.weak", { min: PASSWORD_MIN_LENGTH })
    : sp.error === "mismatch" ? t("password.mismatch")
    : sp.error === "wrong" ? t("password.wrong")
    : sp.error === "pin" ? t("pin.invalid")
    : sp.error === "totp" ? t("totp.bad")
    : null;

  return (
    <AppShell user={user} title={t("title")}>
      <p className="muted mb-4">{user.name} · {user.email}</p>
      {ok ? <p className="alert-ok mb-4" role="status">{ok}</p> : null}
      {error ? <p className="alert-error mb-4" role="alert">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <form action={changePasswordAction} className="card space-y-3">
          <h2 className="text-lg font-semibold">{t("password.title")}</h2>
          {full.passwordHash ? (
            <div>
              <label className="label" htmlFor="current">{t("password.current")}</label>
              <input id="current" name="current" type="password" autoComplete="current-password" className="input" />
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="password">{t("password.new")}</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="confirm">{t("password.confirm")}</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
          </div>
          <button type="submit" className="btn-primary">{t("password.submit")}</button>
        </form>

        {isSecurity ? (
          <form action={setPinAction} className="card space-y-3">
            <h2 className="text-lg font-semibold">{t("pin.title")}</h2>
            <p className="muted">{t("pin.help")}</p>
            <div>
              <label className="label" htmlFor="pin">{t("pin.new")}</label>
              <input id="pin" name="pin" inputMode="numeric" pattern="[0-9]{4,8}" required autoComplete="off" className="input" />
            </div>
            <button type="submit" className="btn-primary">{t("pin.submit")}</button>
          </form>
        ) : null}

        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">{t("totp.title")}</h2>
          <p className="muted">{full.totpSecret ? t("totp.enabled") : t("totp.disabled")}</p>
          {pending ? (
            <form action={totpConfirmAction} className="space-y-3">
              <p className="muted">{t("totp.uri")}</p>
              <p className="label">{t("totp.secret")}</p>
              <code className="block break-all rounded bg-surface-2 p-2 text-sm" data-testid="totp-secret">{pending}</code>
              <a className="muted underline" href={totpUri(pending, user.email)}>otpauth://…</a>
              <div>
                <label className="label" htmlFor="code">{t("totp.code")}</label>
                <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="input" />
              </div>
              <button type="submit" className="btn-primary">{t("totp.confirm")}</button>
            </form>
          ) : !full.totpSecret ? (
            <form action={totpStartAction}>
              <button type="submit" className="btn-secondary">{t("totp.start")}</button>
            </form>
          ) : null}
        </section>

        <section className="card space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon icon={BellRing} /> {tn("title")}</h2>
          <p className="muted">{tn("linkHelp")}</p>
          <Link href="/account/notifications" className="btn-secondary">{tn("link")}</Link>
        </section>
      </div>
    </AppShell>
  );
}
