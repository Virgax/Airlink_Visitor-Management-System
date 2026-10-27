import "server-only";
import type { Employee } from "@prisma/client";
import { db } from "@/lib/db";

export type EmployeeHit = Pick<Employee, "id" | "name" | "department" | "extension" | "email" | "phone" | "photoKey" | "siteId" | "active" | "source" | "syncedAt">;

/**
 * Directory search shared by the host and guard panels (host picker, unannounced visits).
 *
 * @param siteId  Site of the caller (`tenant.site?.id`), or `null` for every site. Employees with no site
 *                (company-wide, e.g. straight from SPN) are always included.
 * @param query   Free text; matched case-insensitively against name, department and email.
 *                An empty query returns the first `limit` active employees by name.
 * @param opts    `limit` max rows (default 20, max 100); `includeInactive` also returns deactivated employees
 *                (admin directory only; pickers must leave it off).
 */
export async function searchEmployees(siteId: string | null, query: string, opts: { limit?: number; includeInactive?: boolean } = {}): Promise<EmployeeHit[]> {
  const q = query.trim().replace(/\s+/g, " ");
  const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const terms = q ? q.split(" ").slice(0, 5) : [];
  return db.employee.findMany({
    where: {
      ...(opts.includeInactive ? {} : { active: true }),
      ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
      AND: terms.map((term) => ({
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { department: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
        ],
      })),
    },
    select: { id: true, name: true, department: true, extension: true, email: true, phone: true, photoKey: true, siteId: true, active: true, source: true, syncedAt: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take,
  });
}
