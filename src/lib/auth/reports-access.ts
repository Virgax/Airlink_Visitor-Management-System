import "server-only";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { AuthError, getMembershipOrThrow, requireUser, type Tenant } from "@/lib/auth/guards";

const REPORT_ROLES: MembershipRole[] = ["admin", "security"];

/**
 * Reports are readable by admins and by security staff (each scoped by their own membership).
 * Resolves the first role the user holds, in that order; redirects like `requireMembership` otherwise.
 */
export async function requireReportsTenant(nextPath: string): Promise<Tenant & { role: MembershipRole }> {
  await requireUser(nextPath);
  const tenant = await getReportsTenantOrNull();
  if (!tenant) redirect("/select-panel");
  return tenant;
}

/** Same as `requireReportsTenant` but throws (route handlers). */
export async function getReportsTenantOrThrow(): Promise<Tenant & { role: MembershipRole }> {
  const tenant = await getReportsTenantOrNull();
  if (!tenant) throw new AuthError("forbidden");
  return tenant;
}

async function getReportsTenantOrNull(): Promise<(Tenant & { role: MembershipRole }) | null> {
  for (const role of REPORT_ROLES) {
    try {
      const tenant = await getMembershipOrThrow(role);
      return { ...tenant, role };
    } catch (err) {
      if (err instanceof AuthError && err.code === "unauthenticated") throw err;
    }
  }
  return null;
}
