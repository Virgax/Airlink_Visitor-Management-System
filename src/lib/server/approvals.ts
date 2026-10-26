import "server-only";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { AuthError, getMembershipOrThrow, type Tenant } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/session";

export type ApproverRole = Extract<MembershipRole, "approver" | "security">;
export const APPROVER_ROLES: ApproverRole[] = ["approver", "security"];

export type ApproverTenants = { user: SessionUser; tenants: Partial<Record<ApproverRole, Tenant>>; roles: ApproverRole[] };

/**
 * Approvals are open to `approver` (management) and `security`. Resolves the tenant for each role the user holds;
 * a user with neither is sent to the panel selector (pages) or gets a forbidden error (actions).
 */
export async function getApproverTenants(): Promise<ApproverTenants> {
  const tenants: Partial<Record<ApproverRole, Tenant>> = {};
  let user: SessionUser | null = null;
  for (const role of APPROVER_ROLES) {
    try {
      const t = await getMembershipOrThrow(role);
      tenants[role] = t;
      user = t.user;
    } catch (err) {
      if (err instanceof AuthError && err.code === "unauthenticated") throw err;
    }
  }
  const roles = APPROVER_ROLES.filter((r) => tenants[r]);
  if (!user || roles.length === 0) throw new AuthError("forbidden");
  return { user, tenants, roles };
}

export async function requireApproverTenants(nextPath: string): Promise<ApproverTenants> {
  try {
    return await getApproverTenants();
  } catch (err) {
    if (err instanceof AuthError && err.code === "unauthenticated") redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    redirect("/select-panel");
  }
}
