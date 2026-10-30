import "server-only";
import type { Prisma } from "@prisma/client";
import type { Tenant } from "@/lib/auth/guards";

/**
 * Passes a host may see: created by them or hosted by their Employee, within the tenant's sites. Admins and security
 * staff (who issue invitations on behalf of hosts) see every pass of their sites.
 */
export function ownPassWhere(tenant: Tenant & { role?: string }): Prisma.PassWhereInput {
  if (tenant.role === "admin" || tenant.role === "security") return { ...tenant.siteFilter };
  const owner: Prisma.PassWhereInput[] = [{ createdById: tenant.user.id }];
  if (tenant.user.employeeId) owner.push({ hostEmployeeId: tenant.user.employeeId });
  return { ...tenant.siteFilter, OR: owner };
}
