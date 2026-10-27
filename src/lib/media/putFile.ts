import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Private media in the S3-compatible bucket (Railway `visitas-media`). Keys are `s/<siteId>/<kind>/<id>.<ext>` so the
 * access check in `/api/media` can derive the site from the key. Nothing is ever public: the only reader is that route.
 * PNG/JPEG only: sniffed by magic bytes, then re-encoded with sharp (rotation applied, metadata stripped).
 */

export type ImageType = "image/png" | "image/jpeg";

const EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg" };

/** Content type from the first bytes, or null when the bytes are not a PNG/JPEG. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function extensionFor(type: ImageType): string {
  return EXT[type];
}

export function mediaConfigured(): boolean {
  const e = env();
  return Boolean(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && (e.S3_ENDPOINT || e.S3_REGION));
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const e = env();
  client = new S3Client({
    region: e.S3_REGION ?? "auto",
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: Boolean(e.S3_ENDPOINT),
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID ?? "", secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "" },
  });
  return client;
}

/** Key for a media object; `siteId` is the first path segment after `s/` and is what the media route authorizes on. */
export function mediaKey(siteId: string, kind: "visits" | "shiftlogs", id: string, type: ImageType): string {
  return `s/${siteId}/${kind}/${id}.${extensionFor(type)}`;
}

/** Site id encoded in a media key, or null for a malformed key. */
export function siteIdFromKey(key: string): string | null {
  const m = /^s\/([A-Za-z0-9_-]+)\/(visits|shiftlogs)\/[A-Za-z0-9_-]+\.(png|jpg)$/.exec(key);
  return m?.[1] ?? null;
}

/** Stores bytes under `key`. Throws when the bucket is not configured; callers check `mediaConfigured()` first. */
/** Re-encodes an image with sharp: applies EXIF rotation, drops all metadata (GPS, device), caps the size. */
export async function reencodeImage(body: Uint8Array, contentType: ImageType): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const pipeline = sharp(body, { failOn: "error", limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true });
  const out = contentType === "image/png" ? await pipeline.png({ compressionLevel: 8 }).toBuffer() : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  return new Uint8Array(out);
}

/** Stores an image in the private bucket after sniffing (caller) and re-encoding (here). */
export async function putFile(key: string, body: Uint8Array, contentType: ImageType): Promise<void> {
  const e = env();
  const clean = await reencodeImage(body, contentType);
  await s3().send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: clean, ContentType: contentType, CacheControl: "private, max-age=0" }));
  log.info("media.put", { key, bytes: clean.byteLength });
}

/** Reads an object; null when it does not exist. */
export async function getFile(key: string): Promise<{ body: ReadableStream; contentType: string; contentLength?: number } | null> {
  const e = env();
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
    if (!res.Body) return null;
    return { body: res.Body.transformToWebStream() as ReadableStream, contentType: res.ContentType ?? "application/octet-stream", contentLength: res.ContentLength };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}
