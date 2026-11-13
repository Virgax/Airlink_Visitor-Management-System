import "server-only";
import { db } from "@/lib/db";
import { mediaConfigured, mediaKey, putFile, sniffImage } from "@/lib/media/putFile";
import { loadPolicyAndForm } from "@/lib/server/forms";
import { readSiteSettings } from "@/lib/server/sites";
import { log } from "@/lib/log";

export const MAX_PASS_PHOTO_BYTES = 8 * 1024 * 1024;

/** The three photos a visitor may have to attach: their face, and the front and back of their identity document. */
export const PHOTO_SLOTS = ["face", "idFront", "idBack"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
const COLUMN: Record<PhotoSlot, "photoKey" | "idFrontKey" | "idBackKey"> = { face: "photoKey", idFront: "idFrontKey", idBack: "idBackKey" };
/** Field names in the host and visitor forms. */
export const PHOTO_FIELDS: Record<PhotoSlot, string> = { face: "photo", idFront: "idFront", idBack: "idBack" };

export type StorePhotoResult = { ok: true; key: string } | { ok: false; error: "media" | "tooBig" | "invalid" | "failed" };

/**
 * Stores one of a pass's photos (from the host form or the visitor link): sniffed, re-encoded and metadata-stripped
 * by `putFile`, under `s/<siteId>/visits/pass-<passId>-<slot>-<stamp>.<ext>`. Only the key is kept on the pass.
 */
export async function storePassPhoto(pass: { id: string; siteId: string }, file: File, slot: PhotoSlot = "face"): Promise<StorePhotoResult> {
  if (!mediaConfigured()) return { ok: false, error: "media" };
  if (file.size > MAX_PASS_PHOTO_BYTES) return { ok: false, error: "tooBig" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false, error: "invalid" };
  const key = mediaKey(pass.siteId, "visits", `pass-${pass.id}-${slot}-${Date.now().toString(36)}`, type);
  try {
    await putFile(key, bytes, type);
  } catch (err) {
    log.error("pass.photo_failed", { passId: pass.id, slot, err: String(err) });
    return { ok: false, error: "failed" };
  }
  await db.pass.update({ where: { id: pass.id }, data: { [COLUMN[slot]]: key } });
  return { ok: true, key };
}

/** A posted file field with content, or null. */
export function photoFile(formData: FormData, name = "photo"): File | null {
  const f = formData.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

export type PassPhotos = { photoKey: string | null; idFrontKey: string | null; idBackKey: string | null };

/** Which required photos a pass still lacks: all three when the site demands photos of everyone, else the face when the kind's policy asks for it. */
export async function missingPhotos(pass: { siteId: string; kind: Parameters<typeof loadPolicyAndForm>[1] } & PassPhotos): Promise<PhotoSlot[]> {
  if (!mediaConfigured()) return []; // nobody could satisfy the rule without a bucket
  const site = await db.site.findUnique({ where: { id: pass.siteId }, select: { settings: true } });
  const requireAll = site ? readSiteSettings(site).requirePhotos : false;
  const out: PhotoSlot[] = [];
  if (requireAll) {
    if (!pass.photoKey) out.push("face");
    if (!pass.idFrontKey) out.push("idFront");
    if (!pass.idBackKey) out.push("idBack");
    return out;
  }
  const { policy } = await loadPolicyAndForm(pass.siteId, pass.kind);
  if (policy?.requiresPhoto && !pass.photoKey) out.push("face");
  return out;
}

/** True when the pass cannot enter yet because a required photo is missing. */
export async function photoRequiredMissing(pass: { siteId: string; kind: Parameters<typeof loadPolicyAndForm>[1] } & PassPhotos): Promise<boolean> {
  return (await missingPhotos(pass)).length > 0;
}
