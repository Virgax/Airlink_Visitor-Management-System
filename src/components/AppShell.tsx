import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LayoutGrid, LogOut, UserCircle } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import type { SessionUser } from "@/lib/auth/session";

export async function AppShell({
  user,
  title,
  subtitle,
  children,
  kiosk = false,
}: {
  user: SessionUser | null;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  kiosk?: boolean;
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {t("app.skipToContent")}
      </a>
      <header className="border-b border-border bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-3 font-semibold text-text" aria-label={t("app.name")}>
            <Logo className="h-8 w-auto" />
            <span className="hidden border-l border-border pl-3 text-text-muted sm:inline">Visitas</span>
          </Link>
          {subtitle ? <span className="muted hidden sm:inline">· {subtitle}</span> : null}
          <div className="ml-auto flex items-center gap-2">
            {!kiosk ? <LocaleSwitcher current={locale} label={t("locale.switch")} /> : null}
            <ThemeToggle label={t("theme.toggle")} />
            {user && !kiosk ? (
              <>
                <NotificationBell userId={user.id} />
                <Link href="/select-panel" className="btn-secondary px-2 py-2" title={t("nav.panels")} aria-label={t("nav.panels")}>
                  <Icon icon={LayoutGrid} />
                </Link>
                <Link href="/account" className="btn-secondary px-2 py-2" title={t("nav.account")} aria-label={t("nav.account")}>
                  <Icon icon={UserCircle} />
                </Link>
              </>
            ) : null}
            {user ? (
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="btn-secondary px-2 py-2" title={t("nav.logout")} aria-label={t("nav.logout")}>
                  <Icon icon={LogOut} />
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {title ? <h1 className="mb-4 text-2xl font-semibold">{title}</h1> : null}
        {children}
      </main>
      <footer className="border-t border-border py-4 print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 text-xs text-text-muted">
          <span>© {new Date().getFullYear()} Airlink Distribution DR</span>
          <Link href="/legal/privacidad" className="hover:underline">{t("nav.privacy")}</Link>
          <Link href="/legal/terminos" className="hover:underline">{t("nav.terms")}</Link>
        </div>
      </footer>
    </div>
  );
}
