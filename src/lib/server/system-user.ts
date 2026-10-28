import "server-only";
import { db } from "@/lib/db";

export const SYSTEM_USER_EMAIL = "system@airlinkdr.com";

/**
 * The service account that owns records created without a signed-in user (gate QR self sign-in visits).
 * Active, no password, no memberships: it can never sign in or open a panel. Created on first use.
 */
export async function systemUserId(): Promise<string> {
  const existing = await db.user.findUnique({ where: { email: SYSTEM_USER_EMAIL }, select: { id: true } });
  if (existing) return existing.id;
  const created = await db.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    create: { email: SYSTEM_USER_EMAIL, name: "Sistema", status: "active" },
    update: {},
    select: { id: true },
  });
  return created.id;
}
