import { getTranslations } from "next-intl/server";
import { MenuBar, type MenuSection } from "@/components/nav/MenuBar";
import { db } from "@/lib/db";

/** Host panel menu; each entry appears only for users who hold the role it needs. */
export async function HostNav({ userId }: { userId: string }) {
  const t = await getTranslations("host.nav");
  const roles = await db.membership.findMany({ where: { userId, status: "active" }, select: { role: true }, distinct: ["role"] });
  const has = (r: "host" | "approver" | "security" | "warden" | "admin") => roles.some((m) => m.role === r);
  const sections: MenuSection[] = [
    ...(has("host") || has("admin") || has("security") ? [{ key: "passes", href: "/app", label: t("passes"), icon: "passes" as const }, { key: "new", href: "/app/passes/new", label: t("new"), icon: "invite" as const }] : []),
    ...(has("approver") || has("security") || has("admin") ? [{ key: "approvals", href: "/app/approvals", label: t("approvals"), icon: "approvals" as const }] : []),
    ...(has("warden") || has("security") || has("admin") ? [{ key: "evacuation", href: "/app/evacuacion", label: t("evacuation"), icon: "evacuation" as const }] : []),
  ];
  return <MenuBar label={t("passes")} sections={sections} />;
}
