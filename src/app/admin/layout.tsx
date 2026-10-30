import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { requireReportsTenant } from "@/lib/auth/reports-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Admins see everything; security staff only the reports (each page still enforces its own role).
  const tenant = await requireReportsTenant("/admin");
  const t = await getTranslations("admin");
  const adminItems = [
    { href: "/admin", label: t("overview") },
    { href: "/admin/sites", label: t("sites") },
    { href: "/admin/policies", label: t("policies") },
    { href: "/admin/nda", label: t("nda") },
    { href: "/admin/people", label: t("people") },
    { href: "/admin/frequent", label: t("frequent") },
    { href: "/admin/forms", label: t("forms") },
    { href: "/admin/companies", label: t("companies") },
    { href: "/admin/blacklist", label: t("blacklist") },
    { href: "/admin/devices", label: t("devices") },
    { href: "/admin/reports", label: t("reports") },
    { href: "/help", label: t("help") },
  ];
  const items = tenant.role === "admin" ? adminItems : [{ href: "/admin/reports", label: t("reports") }, { href: "/admin/frequent", label: t("frequent") }, { href: "/help", label: t("help") }];
  return (
    <AppShell user={tenant.user} subtitle={t("title")}>
      <nav aria-label={t("title")} className="mb-6 flex flex-wrap gap-2 print:hidden">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="btn-secondary text-sm">{i.label}</Link>
        ))}
      </nav>
      {children}
    </AppShell>
  );
}
