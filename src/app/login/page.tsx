import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth/session";
import { entraConfigured } from "@/lib/env";
import { loginAction, totpAction } from "./actions";

type Search = { error?: string; step?: string; next?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/select-panel");
  const t = await getTranslations("login");
  const errorKey = sp.error && ["invalid", "totp", "rateLimited", "entra", "disabled"].includes(sp.error) ? sp.error : null;
  const entra = entraConfigured();
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "";

  return (
    <AppShell user={null}>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="muted mt-1">{t("subtitle")}</p>

          {errorKey ? <p role="alert" className="alert-error mt-4">{t(`errors.${errorKey}` as "errors.invalid")}</p> : null}

          {sp.step === "totp" ? (
            <form action={totpAction} className="mt-6 space-y-4">
              <div>
                <label htmlFor="code" className="label">{t("totp")}</label>
                <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" required autoFocus className="input" />
                <p className="muted mt-1">{t("totpHelp")}</p>
              </div>
              <button type="submit" className="btn-primary w-full">{t("submit")}</button>
            </form>
          ) : (
            <>
              {entra ? (
                <div className="mt-6">
                  <a href={`/api/auth/entra/start${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn-primary w-full">
                    {t("microsoft")}
                  </a>
                  <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
                    <span className="h-px flex-1 bg-border" /> {t("or")} <span className="h-px flex-1 bg-border" />
                  </div>
                </div>
              ) : null}
              <form action={loginAction} className={`space-y-4 ${entra ? "" : "mt-6"}`}>
                {entra ? <p className="muted">{t("localOnly")}</p> : null}
                <input type="hidden" name="next" value={next} />
                <div>
                  <label htmlFor="email" className="label">{t("email")}</label>
                  <input id="email" name="email" type="email" autoComplete="username" required className="input" />
                </div>
                <div>
                  <label htmlFor="password" className="label">{t("password")}</label>
                  <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
                </div>
                <button type="submit" className="btn-primary w-full">{t("submit")}</button>
              </form>
            </>
          )}
        </div>
        <p className="muted mt-4 text-center">
          <Link href="/legal/privacidad" className="hover:underline">Aviso de privacidad</Link>
        </p>
      </div>
    </AppShell>
  );
}
