import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { requireMembership } from "@/lib/auth/guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireMembership("admin", "/admin");
  const t = await getTranslations("admin");
  const items = [
    { href: "/admin", label: t("overview") },
    { href: "/admin/sites", label: t("sites") },
    { href: "/admin/policies", label: t("policies") },
    { href: "/admin/employees", label: t("employees") },
    { href: "/admin/companies", label: t("companies") },
    { href: "/admin/blacklist", label: t("blacklist") },
    { href: "/admin/members", label: t("members") },
    { href: "/admin/devices", label: t("devices") },
  ];
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
