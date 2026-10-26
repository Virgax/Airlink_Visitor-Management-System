import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { requireReportsTenant } from "@/lib/auth/reports-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Admins see everything; security staff only the reports (each page still enforces its own role).
  const tenant = await requireReportsTenant("/admin");
  const t = await getTranslations("admin");
  const items =
    tenant.role === "admin"
      ? [
          { href: "/admin", label: t("overview") },
          { href: "/admin/members", label: t("members") },
          { href: "/admin/devices", label: t("devices") },
          { href: "/admin/reports", label: t("reports") },
        ]
      : [{ href: "/admin/reports", label: t("reports") }];
  return (
    <AppShell user={tenant.user} subtitle={t("title")}>
      <nav aria-label={t("title")} className="mb-6 flex flex-wrap gap-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="btn-secondary text-sm">{i.label}</Link>
        ))}
      </nav>
      {children}
    </AppShell>
  );
}
