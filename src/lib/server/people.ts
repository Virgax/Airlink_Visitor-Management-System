import "server-only";
import type { EmployeeSource, MembershipRole, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * The merged "Personas" screen: one row per Employee (hosts, with their linked User when any) plus local Users that
 * have no employee record (break-glass admin, guards). Role chips come from active memberships; "host" is simply an
 * active employee. Queries are scoped by the admin's sites; employees without site are visible everywhere.
 */

export const PEOPLE_TABS = ["all", "pin", "hosts", "admins", "wardens", "inactive"] as const;
export type PeopleTab = (typeof PEOPLE_TABS)[number];
export const PEOPLE_PAGE_SIZES = [25, 50, 100] as const;

export type PersonRole = { role: MembershipRole; siteId: string | null; membershipId: string };

export type PersonRow = {
  /** `emp:<id>` or `user:<id>`: what the row actions post back. */
  key: string;
  employeeId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  department: string | null;
  siteId: string | null;
  source: EmployeeSource | "user";
  active: boolean;
  hasPin: boolean;
  roles: PersonRole[];
};

export type PeopleQuery = { tab: PeopleTab; q: string; page: number; pageSize: number };

export type PeopleScope = { siteIds: string[] | null };

export function parsePeopleQuery(sp: Record<string, string | string[] | undefined>): PeopleQuery {
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const tabRaw = pick(sp.tab);
  const tab = (PEOPLE_TABS as readonly string[]).includes(tabRaw as string) ? (tabRaw as PeopleTab) : "all";
  const q = typeof pick(sp.q) === "string" ? (pick(sp.q) as string).trim().slice(0, 80) : "";
  const pageSizeRaw = Number(pick(sp.perPage) ?? 25);
  const pageSize = (PEOPLE_PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : 25;
  const pageRaw = Number(pick(sp.page) ?? 1);
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1;
  return { tab, q, page, pageSize };
}

function termsWhere(q: string): Prisma.EmployeeWhereInput[] {
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
  return terms.map((term) => ({
    OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { department: { contains: term, mode: "insensitive" } }],
  }));
}

/** Loads every person visible to the scope, applies tab + search, then paginates in memory (directory sizes are small). */
export async function queryPeople(scope: PeopleScope, query: PeopleQuery): Promise<{ rows: PersonRow[]; total: number; pages: number; page: number; counts: Record<PeopleTab, number> }> {
  const siteWhere: Prisma.EmployeeWhereInput = scope.siteIds ? { OR: [{ siteId: null }, { siteId: { in: scope.siteIds } }] } : {};
  const membershipWhere: Prisma.MembershipWhereInput = { status: "active", ...(scope.siteIds ? { OR: [{ siteId: null }, { siteId: { in: scope.siteIds } }] } : {}) };
  const [employees, users] = await Promise.all([
    db.employee.findMany({
      where: { AND: [siteWhere, ...termsWhere(query.q)] },
      select: { id: true, name: true, email: true, department: true, siteId: true, source: true, active: true, pinHash: true, user: { select: { id: true, pinHash: true, status: true, memberships: { where: membershipWhere, select: { id: true, role: true, siteId: true } } } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: 5000,
    }),
    db.user.findMany({
      where: {
        employeeId: null,
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] } : {}),
        ...(scope.siteIds ? { memberships: { some: membershipWhere } } : {}),
      },
      select: { id: true, name: true, email: true, status: true, pinHash: true, memberships: { where: membershipWhere, select: { id: true, role: true, siteId: true } } },
      orderBy: { name: "asc" },
      take: 2000,
    }),
  ]);
  const all: PersonRow[] = [
    ...employees.map((e) => ({
      key: `emp:${e.id}`,
      employeeId: e.id,
      userId: e.user?.id ?? null,
      name: e.name,
      email: e.email,
      department: e.department,
      siteId: e.siteId,
      source: e.source,
      active: e.active,
      hasPin: Boolean(e.pinHash || e.user?.pinHash),
      roles: (e.user?.memberships ?? []).map((m) => ({ role: m.role, siteId: m.siteId, membershipId: m.id })),
    })),
    ...users.map((u) => ({
      key: `user:${u.id}`,
      employeeId: null,
      userId: u.id,
      name: u.name,
      email: u.email,
      department: null,
      siteId: null,
      source: "user" as const,
      active: u.status === "active",
      hasPin: Boolean(u.pinHash),
      roles: u.memberships.map((m) => ({ role: m.role, siteId: m.siteId, membershipId: m.id })),
    })),
  ].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const matches = (row: PersonRow, tab: PeopleTab): boolean => {
    switch (tab) {
      case "pin":
        return row.hasPin;
      case "hosts":
        return row.employeeId !== null && row.active;
      case "admins":
        return row.roles.some((r) => r.role === "admin");
      case "wardens":
        return row.roles.some((r) => r.role === "warden");
      case "inactive":
        return !row.active;
      default:
        return true;
    }
  };
  const counts = Object.fromEntries(PEOPLE_TABS.map((t) => [t, all.filter((r) => matches(r, t)).length])) as Record<PeopleTab, number>;
  const filtered = all.filter((r) => matches(r, query.tab));
  const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, pages);
  return { rows: filtered.slice((page - 1) * query.pageSize, page * query.pageSize), total: filtered.length, pages, page, counts };
}

/** Parses a row key posted by the people screen. */
export function parseRowKey(raw: unknown): { kind: "emp" | "user"; id: string } | null {
  if (typeof raw !== "string") return null;
  const m = /^(emp|user):([A-Za-z0-9_-]{1,64})$/.exec(raw);
  return m ? { kind: m[1] as "emp" | "user", id: m[2]! } : null;
}
