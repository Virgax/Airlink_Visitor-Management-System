import "server-only";
import type { Employee } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Hosts are Employee rows (mirror of SPN/Entra). A signed-in user is normally linked by email at JIT provisioning;
 * local users (break-glass admin, test hosts) may have no Employee yet. This links by email or creates a minimal
 * manual Employee on first use so they can host passes. Never writes to SPN.
 */
export async function ensureEmployeeForUser(user: Pick<SessionUser, "id" | "email" | "name" | "employeeId">): Promise<Employee> {
  if (user.employeeId) {
    const existing = await db.employee.findUnique({ where: { id: user.employeeId } });
    if (existing) return existing;
  }
  const email = user.email.toLowerCase();
  const byEmail = await db.employee.findUnique({ where: { email }, include: { user: { select: { id: true } } } });
  let employee: Employee;
  if (byEmail && (!byEmail.user || byEmail.user.id === user.id)) {
    const { user: _u, ...row } = byEmail;
    employee = row;
  } else {
    // No directory row for this email (or it belongs to another user): create a minimal manual employee.
    employee = await db.employee.create({ data: { email: byEmail ? null : email, name: user.name || email, source: "manual", siteId: null } });
  }
  await db.user.update({ where: { id: user.id }, data: { employeeId: employee.id } });
  return employee;
}
