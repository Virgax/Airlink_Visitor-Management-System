import "server-only";
import { db } from "@/lib/db";
import { AuthError, assertSiteAllowed, type Tenant } from "@/lib/auth/guards";
import { parseRowKey } from "@/lib/server/people";

/**
 * A site-bound admin may only act on users whose memberships all fall inside their own sites: company-wide
 * memberships (siteId null) and memberships of other sites are out of reach, so they cannot disable, re-link
 * or re-PIN a company-wide admin from the Personas screen.
 */
export async function assertUserManageable(tenant: Tenant, userId: string): Promise<void> {
  if (tenant.membership.siteId === null) return;
  const allowed = new Set(tenant.sites.map((s) => s.id));
  const outside = await db.membership.findFirst({
    where: { userId, OR: [{ siteId: null }, { siteId: { notIn: [...allowed] } }] },
    select: { id: true },
  });
  if (outside) throw new AuthError("forbidden");
}

export type PersonDetail = {
  key: string;
  employee: { id: string; name: string; email: string | null; department: string | null; extension: string | null; phone: string | null; siteId: string | null; source: "spn" | "entra" | "manual"; active: boolean; hasPin: boolean } | null;
  user: { id: string; email: string; name: string; status: string; hasPassword: boolean; hasTotp: boolean; hasPin: boolean; memberships: { id: string; role: string; siteId: string | null; status: string; siteName: string | null }[] } | null;
};

/** Loads a person (employee and/or local user) for the edit page; null when the key is unknown. Re-checks the site. */
export async function loadPersonDetail(tenant: Tenant, rawKey: unknown): Promise<PersonDetail | null> {
  const key = parseRowKey(rawKey);
  if (!key) return null;
  const userSelect = { id: true, email: true, name: true, status: true, passwordHash: true, totpSecret: true, pinHash: true, memberships: { select: { id: true, role: true, siteId: true, status: true, site: { select: { name: true } } }, orderBy: [{ role: "asc" as const }, { siteId: "asc" as const }] } };
  let employee: PersonDetail["employee"] = null;
  let userRow: { id: string; email: string; name: string; status: string; passwordHash: string | null; totpSecret: string | null; pinHash: string | null; memberships: { id: string; role: string; siteId: string | null; status: string; site: { name: string } | null }[] } | null = null;
  if (key.kind === "emp") {
    const e = await db.employee.findUnique({ where: { id: key.id }, include: { user: { select: userSelect } } });
    if (!e) return null;
    if (e.siteId) assertSiteAllowed(tenant, e.siteId);
    employee = { id: e.id, name: e.name, email: e.email, department: e.department, extension: e.extension, phone: e.phone, siteId: e.siteId, source: e.source, active: e.active, hasPin: Boolean(e.pinHash) };
    userRow = e.user;
  } else {
    userRow = await db.user.findUnique({ where: { id: key.id }, select: userSelect });
    if (!userRow) return null;
  }
  if (userRow) await assertUserManageable(tenant, userRow.id);
  return {
    key: `${key.kind}:${key.id}`,
    employee,
    user: userRow
      ? {
          id: userRow.id,
          email: userRow.email,
          name: userRow.name,
          status: userRow.status,
          hasPassword: Boolean(userRow.passwordHash),
          hasTotp: Boolean(userRow.totpSecret),
          hasPin: Boolean(userRow.pinHash),
          memberships: userRow.memberships.map((m) => ({ id: m.id, role: m.role, siteId: m.siteId, status: m.status, siteName: m.site?.name ?? null })),
        }
      : null,
  };
}
