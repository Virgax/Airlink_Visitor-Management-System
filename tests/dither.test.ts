import { describe, expect, it } from "vitest";
import { bitmapToRgba, ditherToBadgePhoto, floydSteinberg, packBits, thresholdToBadgePhoto, toGrayscale, unpackBits } from "@/lib/badges/dither";

function gradient(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      const i = (y * w + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

describe("toGrayscale", () => {
  it("uses Rec. 601 luma and composites alpha over white", () => {
    const g = toGrayscale([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0], 3, 1);
    expect(Math.round(g[0]!)).toBe(76);
    expect(Math.round(g[1]!)).toBe(150);
    expect(g[2]).toBe(255); // fully transparent → white
  });
});

describe("floydSteinberg", () => {
  it("turns a horizontal gradient into a density ramp: dark left, light right", () => {
    const w = 16;
    const h = 8;
    const px = floydSteinberg(toGrayscale(gradient(w, h), w, h), w, h);
    const colBlack = (x: number) => Array.from({ length: h }, (_, y) => px[y * w + x]!).reduce((a, b) => a + b, 0);
    expect(colBlack(0)).toBe(h); // pure black column
    expect(colBlack(w - 1)).toBe(0); // pure white column
    const leftHalf = Array.from({ length: w / 2 }, (_, x) => colBlack(x)).reduce((a, b) => a + b, 0);
    const rightHalf = Array.from({ length: w / 2 }, (_, x) => colBlack(x + w / 2)).reduce((a, b) => a + b, 0);
    expect(leftHalf).toBeGreaterThan(rightHalf);
    // Mid-gray must be a mix (diffusion), not a hard edge.
    const mid = colBlack(w / 2 - 1) + colBlack(w / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(2 * h);
  });
  it("preserves overall density (black pixels ≈ 1 − mean/255)", () => {
    const w = 32;
    const h = 32;
    const gray = new Float32Array(w * h).fill(64); // 75 % dark
    const px = floydSteinberg(gray, w, h);
    const black = px.reduce((a, b) => a + b, 0);
    expect(black / (w * h)).toBeCloseTo(0.75, 1);
    expect(gray[0]).toBe(64); // input untouched
  });
});

describe("packBits / unpackBits", () => {
  it("round-trips with MSB-first rows padded to a byte", () => {
    const w = 10;
    const h = 2;
    const px = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 1, 1, 1, /* row 2 */ 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    const bits = packBits(px, w, h);
    expect(bits.length).toBe(4);
    expect(Array.from(bits)).toEqual([0x81, 0xc0, 0x55, 0x40]);
    expect(Array.from(unpackBits(bits, w, h))).toEqual(Array.from(px));
  });
});

describe("ditherToBadgePhoto / thresholdToBadgePhoto / bitmapToRgba", () => {
  it("produces a 160 × 200 packed bitmap of 4000 bytes by default", () => {
    const photo = ditherToBadgePhoto(gradient(160, 200));
    expect(photo.width).toBe(160);
    expect(photo.height).toBe(200);
    expect(photo.bits.length).toBe(4000);
  });
  it("thresholds a grayscale buffer and renders black/white RGBA", () => {
    const photo = thresholdToBadgePhoto([0, 255, 100, 200], 2, 2);
    expect(Array.from(unpackBits(photo.bits, 2, 2))).toEqual([1, 0, 1, 0]);
    const rgba = bitmapToRgba(photo);
    expect(Array.from(rgba.slice(0, 8))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});
