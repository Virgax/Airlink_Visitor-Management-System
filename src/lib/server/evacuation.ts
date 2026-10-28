import "server-only";
import { redirect } from "next/navigation";
import type { MembershipRole, Site } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AuthError, getMembershipOrThrow, type Tenant } from "@/lib/auth/guards";
import type { SessionUser } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/index";
import { evacuationGroups } from "@/lib/server/visits";

/**
 * Evacuation list for the phone (`/app/evacuacion`): visitors inside or at the dock plus employees with an open
 * `EmployeePresence`. Readable by fire wardens (`warden`), security and admins of the site; sendable by the latter two.
 */

export type EvacuationRole = Extract<MembershipRole, "warden" | "security" | "admin">;
export const EVACUATION_ROLES: EvacuationRole[] = ["warden", "security", "admin"];

export type EvacuationAccess = { user: SessionUser; roles: EvacuationRole[]; sites: Site[]; canSend: boolean };

export async function getEvacuationAccess(): Promise<EvacuationAccess> {
  const tenants: Partial<Record<EvacuationRole, Tenant>> = {};
  let user: SessionUser | null = null;
  for (const role of EVACUATION_ROLES) {
    try {
      const t = await getMembershipOrThrow(role);
      tenants[role] = t;
      user = t.user;
    } catch (err) {
      if (err instanceof AuthError && err.code === "unauthenticated") throw err;
    }
  }
  const roles = EVACUATION_ROLES.filter((r) => tenants[r]);
  if (!user || roles.length === 0) throw new AuthError("forbidden");
  const sites = new Map<string, Site>();
  for (const role of roles) for (const s of tenants[role]!.sites) sites.set(s.id, s);
  return { user, roles, sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)), canSend: roles.includes("admin") || roles.includes("security") };
}

export async function requireEvacuationAccess(nextPath: string): Promise<EvacuationAccess> {
  try {
    return await getEvacuationAccess();
  } catch (err) {
    if (err instanceof AuthError && err.code === "unauthenticated") redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    redirect("/select-panel");
  }
}

export type EvacuationPerson = { id: string; name: string; detail: string | null; host: string | null; since: string; status: string };
export type EvacuationSiteSnapshot = {
  siteId: string;
  siteName: string;
  timeZone: string;
  total: number;
  groups: Array<{ area: string; kind: "visitors" | "employees"; people: EvacuationPerson[] }>;
};
export type WardenSnapshot = { generatedAt: string; sites: EvacuationSiteSnapshot[] };

/** Everyone inside a site right now: visitors grouped by area (+ host) and employees with an open presence. */
export async function evacuationSnapshot(sites: Pick<Site, "id" | "name" | "timezone">[], noAreaLabel: string): Promise<WardenSnapshot> {
  const out: EvacuationSiteSnapshot[] = [];
  for (const site of sites) {
    const [visits, presences] = await Promise.all([
      evacuationGroups(site.id, noAreaLabel),
      db.employeePresence.findMany({ where: { siteId: site.id, leftAt: null }, include: { employee: { select: { name: true, department: true } }, gate: { select: { name: true } } }, orderBy: { enteredAt: "desc" } }),
    ]);
    const groups: EvacuationSiteSnapshot["groups"] = visits.groups.map((g) => ({
      area: g.area,
      kind: "visitors",
      people: g.visits.map((v) => ({ id: v.id, name: v.visitorName, detail: v.company?.name ?? null, host: v.host?.name ?? null, since: (v.enteredAt ?? v.createdAt).toISOString(), status: v.status })),
    }));
    if (presences.length) {
      groups.push({
        area: "",
        kind: "employees",
        people: presences.map((p) => ({ id: p.id, name: p.employee.name, detail: p.employee.department, host: p.gate.name, since: p.enteredAt.toISOString(), status: "employee" })),
      });
    }
    out.push({ siteId: site.id, siteName: site.name, timeZone: site.timezone, total: visits.total + presences.length, groups });
  }
  return { generatedAt: new Date().toISOString(), sites: out };
}

/** Fire wardens (and nobody else) of a site: site-bound or company-wide `warden` memberships. */
export async function wardenUserIds(siteId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { status: "active", memberships: { some: { status: "active", role: "warden", OR: [{ siteId }, { siteId: null }] } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Sends the `evacuation_list` notification (push / e-mail fallback, ignores nothing: wardens opted in) to the site's
 * fire wardens with the count of people inside and the link to the phone list. Returns the recipient count.
 */
export async function notifyEvacuationList(siteId: string, actorId: string | null, reason: "manual" | "incident"): Promise<number> {
  const site = await db.site.findUnique({ where: { id: siteId }, select: { id: true, name: true, timezone: true } });
  if (!site) return 0;
  const [wardens, snapshot] = await Promise.all([wardenUserIds(siteId), evacuationSnapshot([site], "")]);
  const count = snapshot.sites[0]?.total ?? 0;
  await notify({ type: "evacuation_list", userIds: wardens, siteId, payload: { siteName: site.name, count, reason }, url: "/app/evacuacion" });
  await audit({ action: "evacuation.sent", siteId, actorId, targetType: "Site", targetId: siteId, meta: { reason, recipients: wardens.length, inside: count } });
  return wardens.length;
}

/** An incident logged as "EVACUACIÓN …" (any accent/case) triggers the list. */
export function isEvacuationIncident(kind: string, text: string): boolean {
  return kind === "incident" && /^\s*evacuaci[oó]n\b/i.test(text.normalize("NFC"));
}
