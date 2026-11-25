import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { MenuBar, type MenuSection } from "@/components/nav/MenuBar";
import { requireReportsTenant } from "@/lib/auth/reports-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Admins see everything; security staff only the reports (each page still enforces its own role).
  const tenant = await requireReportsTenant("/admin");
  const t = await getTranslations("admin");
  const m = await getTranslations("admin.menu");
  const adminSections: MenuSection[] = [
    { key: "home", label: t("overview"), icon: "home", href: "/admin" },
    {
      key: "visits",
      label: m("visits"),
      icon: "visits",
      items: [
        { href: "/app/passes/new", label: t("invite"), icon: "invite", description: m("inviteHint") },
        { href: "/app/approvals", label: m("approvals"), icon: "approvals", description: m("approvalsHint") },
        { href: "/admin/frequent", label: t("frequent"), icon: "frequent", description: m("frequentHint") },
        { href: "/admin/evacuation", label: m("evacuation"), icon: "evacuation", description: m("evacuationHint") },
      ],
    },
    {
      key: "setup",
      label: m("setup"),
      icon: "setup",
      items: [
        { href: "/admin/sites", label: t("sites"), icon: "sites", description: m("sitesHint") },
        { href: "/admin/policies", label: t("policies"), icon: "policies", description: m("policiesHint") },
        { href: "/admin/forms", label: t("forms"), icon: "forms", description: m("formsHint") },
        { href: "/admin/nda", label: t("nda"), icon: "nda", description: m("ndaHint") },
      ],
    },
    {
      key: "people",
      label: t("people"),
      icon: "people",
      items: [
        { href: "/admin/people", label: t("people"), icon: "people", description: m("peopleHint") },
        { href: "/admin/companies", label: t("companies"), icon: "companies", description: m("companiesHint") },
        { href: "/admin/blacklist", label: t("blacklist"), icon: "blacklist", description: m("blacklistHint") },
      ],
    },
    { key: "kiosks", label: m("kiosks"), icon: "kiosks", href: "/admin/devices" },
    { key: "reports", label: t("reports"), icon: "reports", href: "/admin/reports" },
    { key: "help", label: t("help"), icon: "help", href: "/help" },
  ];
  const securitySections: MenuSection[] = [
    { key: "invite", label: t("invite"), icon: "invite", href: "/app/passes/new" },
    { key: "approvals", label: m("approvals"), icon: "approvalsAlt", href: "/app/approvals" },
    { key: "frequent", label: t("frequent"), icon: "frequent", href: "/admin/frequent" },
    { key: "reports", label: t("reports"), icon: "reports", href: "/admin/reports" },
    { key: "help", label: t("help"), icon: "help", href: "/help" },
  ];
  return (
    <AppShell user={tenant.user} subtitle={t("title")}>
      <MenuBar label={t("title")} sections={tenant.role === "admin" ? adminSections : securitySections} />
      {children}
    </AppShell>
  );
}
