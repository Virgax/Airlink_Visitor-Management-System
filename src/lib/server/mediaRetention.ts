import "server-only";
import { db } from "@/lib/db";
import { deleteObject, mediaConfigured } from "@/lib/media/putFile";
import { readSiteSettings } from "@/lib/server/sites";
import { log } from "@/lib/log";

const BATCH = 100;

/**
 * Media retention (cron): photos of passes and visits older than each site's `retentionDays` are deleted from the
 * bucket and their keys cleared. Face and identity-document photos are the most sensitive data the system keeps,
 * so they live exactly as long as the site configured, nothing more. Returns how many files were removed.
 */
export async function purgeExpiredMedia(now = new Date()): Promise<number> {
  if (!mediaConfigured()) return 0;
  const sites = await db.site.findMany({ select: { id: true, settings: true } });
  let removed = 0;
  for (const site of sites) {
    const cutoff = new Date(now.getTime() - readSiteSettings(site).retentionDays * 86_400_000);
    const passes = await db.pass.findMany({
      where: { siteId: site.id, validUntil: { lt: cutoff }, OR: [{ photoKey: { not: null } }, { idFrontKey: { not: null } }, { idBackKey: { not: null } }] },
      select: { id: true, photoKey: true, idFrontKey: true, idBackKey: true },
      take: BATCH,
    });
    for (const p of passes) {
      for (const key of [p.photoKey, p.idFrontKey, p.idBackKey]) if (key) removed += await remove(key);
      await db.pass.update({ where: { id: p.id }, data: { photoKey: null, idFrontKey: null, idBackKey: null } });
    }
    const visits = await db.visit.findMany({
      where: { siteId: site.id, createdAt: { lt: cutoff }, OR: [{ photoKey: { not: null } }, { badgePhotoKey: { not: null } }] },
      select: { id: true, photoKey: true, badgePhotoKey: true },
      take: BATCH,
    });
    for (const v of visits) {
      for (const key of [v.photoKey, v.badgePhotoKey]) if (key) removed += await remove(key);
      await db.visit.update({ where: { id: v.id }, data: { photoKey: null, badgePhotoKey: null } });
    }
  }
  if (removed) log.info("media.purged", { removed });
  return removed;
}

async function remove(key: string): Promise<number> {
  try {
    await deleteObject(key);
    return 1;
  } catch (err) {
    log.warn("media.purge_failed", { key, err: String(err) });
    return 0;
  }
}
