import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { readMrzFromImage } from "../src/lib/server/mrz";

/**
 * End-to-end OCR on a rendered card: the MRZ printed in a monospace font on a photo-sized canvas, with the printed
 * text of a card above it as noise. Exercises tesseract.js with the bundled model, the pre-processing passes and
 * the vote, not the accuracy on real phone photos (checked by hand on real cédulas).
 */
/** ICAO check digit, as in tests/mrz.test.ts. */
function cd(s: string): string {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    sum += (c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55) * w[i % 3]!;
  }
  return String(sum % 10);
}
/**
 * A synthetic cédula without the digit 6: rendered in FreeMono the OCR-B model reads a 6 as "6G", which is a quirk
 * of that font, not of the real OCR-B print on cards (checked on real cédulas by hand).
 */
function syntheticCedula(): { lines: string[]; number: string } {
  for (let n = 0; n < 50; n++) {
    const serial = `AB${String(10000000 + n * 1237).slice(0, 8)}`;
    const cedula = `001${String(1000000 + n * 7919).slice(0, 7)}${n % 10}`;
    const l1 = `IDDOM${serial.slice(0, 9)}<${serial.slice(9)}${cd(serial)}<${cedula}<`;
    const head = `900101${cd("900101")}F350101${cd("350101")}DOMS<<<<<<<<<<`;
    const l2 = head + cd(l1.slice(5, 30) + head.slice(0, 7) + head.slice(8, 15) + head.slice(18, 29));
    const l3 = "PEREZ<GOMEZ<<MARIA<ANA".padEnd(30, "<");
    if (!`${l1}${l2}`.includes("6") && l1.length === 30 && l2.length === 30) return { lines: [l1, l2, l3], number: `${cedula.slice(0, 3)}-${cedula.slice(3, 10)}-${cedula.slice(10)}` };
  }
  throw new Error("no 6-free cédula found");
}

async function renderCard(lines: string[]): Promise<Uint8Array> {
  const esc = (s: string) => s.replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
    <rect width="100%" height="100%" fill="#f4f1f6"/>
    <text x="80" y="140" font-family="DejaVu Sans" font-size="34" fill="#333">Cédula anterior   Colegio electoral 1831</text>
    <text x="80" y="200" font-family="DejaVu Sans" font-size="30" fill="#333">Registro de nacimiento 223-04-2009-01-00027263</text>
    <text x="80" y="260" font-family="DejaVu Sans" font-size="30" fill="#333">SANTO DOMINGO ESTE</text>
    ${lines.map((l, i) => `<text x="70" y="${620 + i * 80}" font-family="FreeMono" font-size="60" letter-spacing="2" fill="#111">${esc(l)}</text>`).join("")}
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
}

/** The rendering needs an OCR-B-like monospace font; FreeMono (GNU FreeFont) is close enough, DejaVu Mono is not. */
function hasFreeMono(): boolean {
  try {
    return execFileSync("fc-list", { encoding: "utf8" }).includes("FreeMono");
  } catch {
    return false;
  }
}

describe("MRZ OCR (tesseract.js + bundled model)", () => {
  it.skipIf(!hasFreeMono())("reads a rendered cédula back", async () => {
    const card = syntheticCedula();
    const id = await readMrzFromImage(await renderCard(card.lines));
    expect(id).not.toBeNull();
    expect(id!.docNumber).toBe(card.number);
    expect(id!.fullName).toBe("Maria Ana Perez Gomez");
    expect(id!.expiryDate).toBe("2035-01-01");
  }, 60_000);
  it("returns null for a photo without an MRZ", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#fff"/><text x="40" y="300" font-family="DejaVu Sans" font-size="40">REPUBLICA DOMINICANA</text></svg>`;
    expect(await readMrzFromImage(new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer()))).toBeNull();
  }, 60_000);
});
