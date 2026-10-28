/**
 * Grayscale + Floyd–Steinberg dithering to a 1-bit bitmap for the badge photo (160 × 200 on the label).
 * Pure and dependency-free so it runs in the kiosk browser (from a canvas) and in unit tests.
 */
import { BADGE_PHOTO, type BadgePhoto } from "@/lib/badges/zpl";

export { BADGE_PHOTO };

/** Luma (Rec. 601) of RGBA pixels; alpha is composited over white. */
export function toGrayscale(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const n = width * height;
  if (rgba.length < n * 4) throw new Error(`toGrayscale: expected ${n * 4} bytes, got ${rgba.length}`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]! / 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = luma * a + 255 * (1 - a);
  }
  return out;
}

/**
 * Floyd–Steinberg error diffusion. Returns one byte per pixel: 1 = black, 0 = white.
 * The input is copied, so the caller's buffer is left untouched.
 */
export function floydSteinberg(gray: Float32Array, width: number, height: number, threshold = 128): Uint8Array {
  const buf = Float32Array.from(gray);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i]!;
      const black = old < threshold;
      out[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) buf[i + 1]! += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1]! += (err * 3) / 16;
        buf[i + width]! += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1]! += err / 16;
      }
    }
  }
  return out;
}

/** Packs 1-byte-per-pixel (1 = black) into the row-major, MSB-first bitmap used by `^GFA`. */
export function packBits(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]) out[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Unpacks a packed bitmap back to one byte per pixel (for previews and tests). */
export function unpackBits(bits: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = (bits[y * bytesPerRow + (x >> 3)]! >> (7 - (x & 7))) & 1;
  }
  return out;
}

/** Full pipeline for a badge photo: RGBA (already resized to `width` × `height`) → packed 1-bit bitmap. */
export function ditherToBadgePhoto(rgba: ArrayLike<number>, width = BADGE_PHOTO.width, height = BADGE_PHOTO.height): BadgePhoto {
  const gray = toGrayscale(rgba, width, height);
  const pixels = floydSteinberg(gray, width, height);
  return { width, height, bits: packBits(pixels, width, height) };
}

/** Thresholds an 8-bit grayscale buffer (one byte per pixel) without diffusion; used for already-dithered PNGs. */
export function thresholdToBadgePhoto(gray: ArrayLike<number>, width: number, height: number, threshold = 128): BadgePhoto {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = gray[i]! < threshold ? 1 : 0;
  return { width, height, bits: packBits(pixels, width, height) };
}

/** RGBA pixels (black/white) of a packed bitmap, for drawing the preview on a canvas. */
export function bitmapToRgba(photo: BadgePhoto): Uint8ClampedArray<ArrayBuffer> {
  const pixels = unpackBits(photo.bits, photo.width, photo.height);
  const out = new Uint8ClampedArray(new ArrayBuffer(photo.width * photo.height * 4));
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i] ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
