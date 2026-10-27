import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarPlus, ListChecks, UserCheck } from "lucide-react";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";

/** Host panel navigation; each link appears only for users who hold the role it needs. */
export async function HostNav({ userId }: { userId: string }) {
  const t = await getTranslations("host.nav");
  const roles = await db.membership.findMany({ where: { userId, status: "active" }, select: { role: true }, distinct: ["role"] });
  const has = (r: "host" | "approver" | "security") => roles.some((m) => m.role === r);
  const items = [
    ...(has("host") ? [{ href: "/app", label: t("passes"), icon: ListChecks }, { href: "/app/passes/new", label: t("new"), icon: CalendarPlus }] : []),
    ...(has("approver") || has("security") ? [{ href: "/app/approvals", label: t("approvals"), icon: UserCheck }] : []),
  ];
  return (
    <nav aria-label={t("passes")} className="mb-6 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="btn-secondary text-sm">
          <Icon icon={i.icon} /> {i.label}
        </Link>
      ))}
    </nav>
  );
}
