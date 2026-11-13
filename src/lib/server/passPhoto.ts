import "server-only";
import { db } from "@/lib/db";
import { mediaConfigured, mediaKey, putFile, sniffImage } from "@/lib/media/putFile";
import { loadPolicyAndForm } from "@/lib/server/forms";
import { log } from "@/lib/log";

export const MAX_PASS_PHOTO_BYTES = 8 * 1024 * 1024;

export type StorePhotoResult = { ok: true; key: string } | { ok: false; error: "media" | "tooBig" | "invalid" | "failed" };

/**
 * Stores the visitor's face photo for a pass (from the host form or the visitor link): sniffed, re-encoded and
 * metadata-stripped by `putFile`, under `s/<siteId>/visits/pass-<passId>.<ext>`. Only the key is kept on the pass.
 */
export async function storePassPhoto(pass: { id: string; siteId: string }, file: File): Promise<StorePhotoResult> {
  if (!mediaConfigured()) return { ok: false, error: "media" };
  if (file.size > MAX_PASS_PHOTO_BYTES) return { ok: false, error: "tooBig" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { ok: false, error: "invalid" };
  const key = mediaKey(pass.siteId, "visits", `pass-${pass.id}-${Date.now().toString(36)}`, type);
  try {
    await putFile(key, bytes, type);
  } catch (err) {
    log.error("pass.photo_failed", { passId: pass.id, err: String(err) });
    return { ok: false, error: "failed" };
  }
  await db.pass.update({ where: { id: pass.id }, data: { photoKey: key } });
  return { ok: true, key };
}

/** A posted `photo` field with content, or null. */
export function photoFile(formData: FormData): File | null {
  const f = formData.get("photo");
  return f instanceof File && f.size > 0 ? f : null;
}

/**
 * True when the kind's policy demands a face photo and the pass has none. Without a media bucket the rule is
 * moot (nobody could satisfy it), so it never blocks there.
 */
export async function photoRequiredMissing(pass: { siteId: string; kind: Parameters<typeof loadPolicyAndForm>[1]; photoKey: string | null }): Promise<boolean> {
  if (!mediaConfigured() || pass.photoKey) return false;
  const { policy } = await loadPolicyAndForm(pass.siteId, pass.kind);
  return Boolean(policy?.requiresPhoto);
}
