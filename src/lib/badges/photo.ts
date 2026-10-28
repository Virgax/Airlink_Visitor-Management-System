import "server-only";
import { BADGE_PHOTO, thresholdToBadgePhoto } from "@/lib/badges/dither";
import type { BadgePhoto } from "@/lib/badges/zpl";
import { getFileBytes, mediaConfigured } from "@/lib/media/putFile";
import { log } from "@/lib/log";

/**
 * Loads the stored badge photo (a 1-bit PNG saved by the kiosk) and turns it into the packed bitmap for `^GFA`.
 * Any decoding problem means "no photo" rather than a failed print.
 */
export async function loadBadgePhoto(key: string | null | undefined): Promise<BadgePhoto | null> {
  if (!key || !mediaConfigured()) return null;
  try {
    const bytes = await getFileBytes(key);
    if (!bytes) return null;
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 4_000_000 })
      .resize(BADGE_PHOTO.width, BADGE_PHOTO.height, { fit: "cover" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) return null;
    return thresholdToBadgePhoto(data, info.width, info.height);
  } catch (err) {
    log.warn("badge.photo_unreadable", { key, err: String(err) });
    return null;
  }
}
