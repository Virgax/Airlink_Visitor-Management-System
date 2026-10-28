import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Membership, MembershipRole, Site } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser, SITE_COOKIE, type SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden") {
    super(code);
  }
}

export const PANEL_PATHS: Record<MembershipRole, string> = {
  admin: "/admin",
  security: "/guard",
  approver: "/app/approvals",
  host: "/app",
  warden: "/app/evacuacion",
};

/** Web session required. A kiosk (PIN) session is valid only for /guard and is sent back there. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  if (user.guardDeviceId) redirect("/guard");
  return user;
}

export type Tenant = {
  user: SessionUser;
  membership: Membership;
  /** The active site. Null only for admins/approvers whose membership covers every site and no site is selected. */
  site: Site | null;
  /** Sites this membership can see. */
  sites: Site[];
  /** Prisma `where` fragment to scope a query by site. */
  siteFilter: { siteId?: string | { in: string[] } };
};

async function resolveTenant(user: SessionUser, role: MembershipRole): Promise<Tenant | null> {
  const jar = await cookies();
  const preferredSite = jar.get(SITE_COOKIE)?.value;

  const memberships = await db.membership.findMany({
    where: { userId: user.id, role, status: "active" },
    include: { site: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  const global = memberships.find((m) => m.siteId === null);
  let sites: Site[];
  if (global) {
    sites = await db.site.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  } else {
    sites = memberships.map((m) => m.site).filter((s): s is Site => !!s && s.active);
  }
  if (sites.length === 0 && !global) return null;

  const site = sites.find((s) => s.id === preferredSite) ?? (global ? null : (sites[0] ?? null));
  const membership = global ?? memberships.find((m) => m.siteId === site?.id) ?? memberships[0]!;
  const { site: _s, ...rest } = membership;

  const siteFilter = site ? { siteId: site.id } : global ? {} : { siteId: { in: sites.map((s) => s.id) } };
  return { user, membership: rest, site, sites, siteFilter };
}

/**
 * Resolves the membership for a role. The active site comes from the `visitas_site` cookie (panel switcher)
 * or, for site-bound memberships, the first site. Admins with siteId = null see every site.
 * Everything downstream must use `tenant.siteFilter` / `tenant.site.id`; never trust ids from the browser.
 */
export async function requireMembership(role: MembershipRole, nextPath?: string): Promise<Tenant> {
  const user = await requireUser(nextPath ?? PANEL_PATHS[role]);
  const tenant = await resolveTenant(user, role);
  if (!tenant) redirect("/select-panel");
  return tenant;
}

/** Same as requireMembership but throws (route handlers and server actions). */
export async function getMembershipOrThrow(role: MembershipRole): Promise<Tenant> {
  const user = await getSessionUser();
  if (!user || user.guardDeviceId) throw new AuthError("unauthenticated");
  const tenant = await resolveTenant(user, role);
  if (!tenant) throw new AuthError("forbidden");
  return tenant;
}

/** Re-checks that an id belongs to the tenant's sites. Use before acting on any id posted by the browser. */
export function assertSiteAllowed(tenant: Tenant, siteId: string): void {
  if (tenant.membership.siteId === null) return;
  if (!tenant.sites.some((s) => s.id === siteId)) throw new AuthError("forbidden");
}

export type PanelOption = { href: string; role: MembershipRole; siteId: string | null; siteName: string | null };

/** All panels a user can open, used by the panel switcher and the post-login redirect. */
export async function listPanels(user: SessionUser): Promise<PanelOption[]> {
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "active" },
    include: { site: { select: { id: true, name: true, active: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return memberships
    .filter((m) => m.site === null || m.site.active)
    .map((m) => ({
      href: PANEL_PATHS[m.role],
      role: m.role,
      siteId: m.site?.id ?? null,
      siteName: m.site?.name ?? null,
    }));
}
