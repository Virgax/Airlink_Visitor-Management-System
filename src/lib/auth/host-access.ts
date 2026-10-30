import "server-only";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { db } from "@/lib/db";
import { AuthError, getMembershipOrThrow, requireUser, type Tenant } from "@/lib/auth/guards";

const INVITE_ROLES: MembershipRole[] = ["host", "admin", "security"];

export type HostTenant = Tenant & { role: MembershipRole };

/**
 * The host panel (/app) is for hosts, and also for admins and security staff who issue invitation links on behalf of
 * a host ("mándame un correo con la visita y yo te genero el link"). First role held wins, in that order.
 */
export async function requireHostTenant(nextPath: string): Promise<HostTenant> {
  await requireUser(nextPath);
  const tenant = await getHostTenantOrNull();
  if (!tenant) redirect("/select-panel");
  return tenant;
}

/** Same as `requireHostTenant` but throws (server actions). */
export async function getHostTenantOrThrow(): Promise<HostTenant> {
  const tenant = await getHostTenantOrNull();
  if (!tenant) throw new AuthError("forbidden");
  return tenant;
}

async function getHostTenantOrNull(): Promise<HostTenant | null> {
  for (const role of INVITE_ROLES) {
    try {
      const tenant = await getMembershipOrThrow(role);
      return { ...tenant, role };
    } catch (err) {
      if (err instanceof AuthError && err.code === "unauthenticated") throw err;
    }
  }
  return null;
}

/** Whether this user may pick another employee as the host of a pass on this site (admin or security there). */
export async function canInviteForOthers(userId: string, siteId: string): Promise<boolean> {
  const m = await db.membership.findFirst({
    where: { userId, status: "active", role: { in: ["admin", "security"] }, OR: [{ siteId }, { siteId: null }] },
    select: { id: true },
  });
  return Boolean(m);
}
