import "server-only";
import type { Site } from "@prisma/client";
import { db } from "@/lib/db";
import { assertSiteAllowed, type Tenant } from "@/lib/auth/guards";

/** Sites an admin may manage: every site (including inactive) for all-sites admins, otherwise their own. */
export async function listManagedSites(tenant: Tenant): Promise<Site[]> {
  if (tenant.membership.siteId === null) return db.site.findMany({ orderBy: { name: "asc" } });
  return db.site.findMany({ where: { id: { in: tenant.sites.map((s) => s.id) } }, orderBy: { name: "asc" } });
}

/** One manageable site by id (from the URL or a form). Throws `forbidden` for sites outside the membership. */
export async function getManagedSite(tenant: Tenant, siteId: string): Promise<Site | null> {
  if (!siteId) return null;
  assertSiteAllowed(tenant, siteId);
  return db.site.findUnique({ where: { id: siteId } });
}

export type SiteSettings = { retentionDays: number; unannouncedTimeoutMin: number };

export const DEFAULT_SITE_SETTINGS: SiteSettings = { retentionDays: 90, unannouncedTimeoutMin: 5 };

export function readSiteSettings(site: Pick<Site, "settings">): SiteSettings & Record<string, unknown> {
  const raw = site.settings && typeof site.settings === "object" && !Array.isArray(site.settings) ? (site.settings as Record<string, unknown>) : {};
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { ...raw, retentionDays: num(raw.retentionDays, DEFAULT_SITE_SETTINGS.retentionDays), unannouncedTimeoutMin: num(raw.unannouncedTimeoutMin, DEFAULT_SITE_SETTINGS.unannouncedTimeoutMin) };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones offered in the site form (Americas first, the rest after). */
export function timeZoneOptions(current?: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  const americas = all.filter((z) => z.startsWith("America/"));
  const rest = all.filter((z) => !z.startsWith("America/"));
  const list = [...americas, ...rest];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}
