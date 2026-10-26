import "server-only";
import type { Prisma } from "@prisma/client";
import type { Tenant } from "@/lib/auth/guards";

/** Passes a host may see: created by them or hosted by their Employee, within the tenant's sites. */
export function ownPassWhere(tenant: Tenant): Prisma.PassWhereInput {
  const owner: Prisma.PassWhereInput[] = [{ createdById: tenant.user.id }];
  if (tenant.user.employeeId) owner.push({ hostEmployeeId: tenant.user.employeeId });
  return { ...tenant.siteFilter, OR: owner };
}
