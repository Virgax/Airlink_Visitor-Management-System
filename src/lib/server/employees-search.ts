import "server-only";
import { db } from "@/lib/db";

import type { EmployeeHit } from "@/lib/guard/types";

export type { EmployeeHit };

/** Host lookup for the kiosk: active employees of the site (or without site) by name or department. */
export async function searchEmployees(q: string, siteId: string, limit = 10): Promise<EmployeeHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return db.employee.findMany({
    where: {
      active: true,
      OR: [{ siteId }, { siteId: null }],
      AND: { OR: [{ name: { contains: term, mode: "insensitive" } }, { department: { contains: term, mode: "insensitive" } }] },
    },
    select: { id: true, name: true, department: true },
    orderBy: { name: "asc" },
    take: limit,
  });
}
