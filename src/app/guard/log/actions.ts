"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getKioskSessionOrNull } from "@/lib/auth/kiosk-session";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { mediaConfigured, mediaKey, putFile, sniffImage } from "@/lib/media/putFile";
import { rateLimit } from "@/lib/rateLimit";
import { SHIFT_LOG_KINDS, SHIFT_LOG_TEXT_MAX } from "@/lib/server/reports-filters";
import { isEvacuationIncident, notifyEvacuationList } from "@/lib/server/evacuation";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const schema = z.object({ kind: z.enum(SHIFT_LOG_KINDS), text: z.string().trim().min(1).max(SHIFT_LOG_TEXT_MAX) });

/** Adds a shift-log entry for the kiosk's site and gate. Photo is optional and only kept when the bucket is configured. */
export async function addShiftLogAction(formData: FormData): Promise<void> {
  const session = await getKioskSessionOrNull();
  if (!session) redirect("/guard");
  const parsed = schema.safeParse({ kind: formData.get("kind"), text: formData.get("text") });
  if (!parsed.success) redirect("/guard/log?error=invalid");

  const limit = await rateLimit(`shiftlog:device:${session.device.id}`, 60, 60);
  if (!limit.ok) redirect("/guard/log?error=rateLimited");

  // Photo: sniff the bytes (never trust the declared type); skip with a notice when storage is not configured.
  const photo = formData.get("photo");
  let bytes: Uint8Array | null = null;
  let type: ReturnType<typeof sniffImage> = null;
  let photoSkipped = false;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_PHOTO_BYTES) redirect("/guard/log?error=photoSize");
    bytes = new Uint8Array(await photo.arrayBuffer());
    type = sniffImage(bytes);
    if (!type) redirect("/guard/log?error=photoType");
    if (!mediaConfigured()) {
      photoSkipped = true;
      bytes = null;
    }
  }

  const entry = await db.shiftLog.create({
    data: { siteId: session.site.id, gateId: session.device.gateId, guardId: session.user.id, kind: parsed.data.kind, text: parsed.data.text },
  });

  if (bytes && type) {
    const key = mediaKey(session.site.id, "shiftlogs", entry.id, type);
    try {
      await putFile(key, bytes, type);
      await db.shiftLog.update({ where: { id: entry.id }, data: { photoKey: key } });
    } catch (err) {
      log.error("shiftlog.photo_failed", { id: entry.id, err: String(err) });
      photoSkipped = true;
    }
  }

  if (parsed.data.kind === "incident") {
    await audit({ action: "shift.incident", siteId: session.site.id, actorId: session.user.id, targetType: "ShiftLog", targetId: entry.id, meta: { gateId: session.device.gateId, photo: Boolean(entry.photoKey) } });
    // An incident logged as "EVACUACIÓN …" pushes the evacuation list to the site's fire wardens.
    if (isEvacuationIncident(parsed.data.kind, parsed.data.text)) {
      await notifyEvacuationList(session.site.id, session.user.id, "incident").catch((err) => log.error("evacuation.notify_failed", { err: String(err) }));
    }
  }
  redirect(photoSkipped ? "/guard/log?ok=nophoto" : "/guard/log?ok=1");
}
