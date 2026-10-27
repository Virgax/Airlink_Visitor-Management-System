import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";

/** Header bell with the server-rendered unread count. Only for signed-in, non-kiosk users. */
export async function NotificationBell({ userId }: { userId: string }) {
  const t = await getTranslations("notifications");
  const unread = await db.notification.count({ where: { userId, readAt: null } });
  const label = t("unreadCount", { count: unread });
  return (
    <Link href="/app/notifications" className="btn-secondary relative px-2 py-2" title={label} aria-label={label} data-testid="notification-bell">
      <Icon icon={Bell} />
      {unread > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-primary-contrast"
          data-testid="unread-count"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
