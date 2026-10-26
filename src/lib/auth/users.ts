import "server-only";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Just-in-time provisioning from Entra: find by entraId, then by email; link to Employee by email.
 * New users get a `host` membership covering every site (siteId = null) unless they already have one.
 */
export async function upsertUserFromEntra(claims: { sub: string; email: string; name: string }): Promise<User> {
  const existing =
    (await db.user.findUnique({ where: { entraId: claims.sub } })) ??
    (await db.user.findUnique({ where: { email: claims.email } }));

  const employee = await db.employee.findUnique({ where: { email: claims.email }, select: { id: true } });

  if (existing) {
    return db.user.update({
      where: { id: existing.id },
      data: {
        entraId: claims.sub,
        name: existing.name || claims.name,
        employeeId: existing.employeeId ?? employee?.id ?? null,
      },
    });
  }

  const user = await db.user.create({
    data: {
      email: claims.email,
      name: claims.name,
      entraId: claims.sub,
      employeeId: employee?.id ?? null,
      memberships: { create: { role: "host", siteId: null } },
    },
  });
  await audit({ action: "user.provisioned", actorId: user.id, targetType: "User", targetId: user.id, meta: { source: "entra" } });
  return user;
}
