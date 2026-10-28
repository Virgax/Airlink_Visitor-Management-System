import { describe, expect, it } from "vitest";
import { bitmapToGfa, LABEL, renderBadgeZpl, zplText, type BadgeData, type BadgePhoto } from "@/lib/badges/zpl";
import { ditherToBadgePhoto } from "@/lib/badges/dither";

/** Fixture photo: a 160 × 200 radial gradient (bright centre, dark corners) dithered to 1 bit, deterministic. */
function fixturePhoto(): BadgePhoto {
  const w = 160;
  const h = 200;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      const v = Math.max(0, Math.min(255, Math.round(255 - 220 * Math.sqrt(dx * dx + dy * dy))));
      const i = (y * w + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return ditherToBadgePhoto(rgba, w, h);
}

const base: BadgeData = {
  visitorName: "Juan Pérez Rodríguez",
  company: "Uptime SRL",
  hostName: "María Gómez · IQC",
  areaNames: ["IQC", "Almacén"],
  kindLabel: "Contratista",
  enteredAt: "27 oct 2026, 09:14",
  gateName: "Recepción",
  badgeNo: "A2R-0042",
  warnings: ["Acompañado", "NDA"],
  qrPayload: "cmh3k9z1x0000abcd12345678.Zm9vYmFyYmF6cXV4MTIzNA",
  docLast4: "5678",
  labels: { host: "Anfitrión", entry: "Entrada", badge: "Gafete", doc: "Doc." },
};

describe("renderBadgeZpl", () => {
  it("renders the landscape template without a photo (snapshot)", () => {
    const zpl = renderBadgeZpl(base, "landscape");
    expect(zpl).toMatchSnapshot();
    expect(zpl.startsWith("^XA\n^CI28\n^MNY\n^PW812\n^LL406")).toBe(true);
    expect(zpl.endsWith("^PQ1\n^XZ")).toBe(true);
    expect(zpl).not.toContain("^GFA");
    expect(zpl).toContain("^BQN,2,6^FDMA,cmh3k9z1x0000abcd12345678.Zm9vYmFyYmF6cXV4MTIzNA^FS");
    expect(zpl).toContain("Juan Pérez Rodríguez");
    expect(zpl).toContain("^FDCONTRATISTA^FS");
    expect(zpl).toContain("ACOMPAÑADO · NDA");
    expect(zpl).toContain("Gafete #A2R-0042 · Doc. ****5678");
  });

  it("renders the landscape_photo template with the fixture bitmap (snapshot)", () => {
    const photo = fixturePhoto();
    const zpl = renderBadgeZpl({ ...base, photo }, "landscape_photo");
    expect(zpl).toMatchSnapshot();
    expect(zpl).toContain(`^FO16,16^GFA,4000,4000,20,`);
    // Text column starts right of the photo.
    expect(zpl).toContain("^FO196,48^A0N,48,48");
  });

  it("ignores the photo on the landscape template and keeps the text at the margin", () => {
    const zpl = renderBadgeZpl({ ...base, photo: fixturePhoto() }, "landscape");
    expect(zpl).not.toContain("^GFA");
    expect(zpl).toContain("^FO16,48^A0N,48,48");
  });

  it("omits empty lines and the document when missing", () => {
    const zpl = renderBadgeZpl({ ...base, company: null, hostName: null, areaNames: [], warnings: [], docLast4: null }, "landscape");
    expect(zpl).not.toContain("Uptime");
    expect(zpl).not.toContain("Anfitrión");
    expect(zpl).not.toContain("****");
    expect(zpl).toContain("^FDGafete #A2R-0042^FS");
  });

  it("truncates long strings and strips ZPL control characters", () => {
    const long = "A".repeat(80);
    const zpl = renderBadgeZpl({ ...base, visitorName: `${long}^XZ~JA\\`, company: "Evil ^FS Corp" }, "landscape");
    expect(zpl).toContain(`^FD${"A".repeat(30)}^FS`);
    expect(zpl).not.toContain("^XZ~JA");
    expect(zpl).toContain("^FDEvil FS Corp^FS");
    expect(zplText("  multiple   spaces\tand\nnewlines ", 100)).toBe("multiple spaces and newlines");
    expect(zplText(null, 5)).toBe("");
  });

  it("keeps every field inside the 812 × 406 label", () => {
    const zpl = renderBadgeZpl({ ...base, photo: fixturePhoto() }, "landscape_photo");
    for (const m of zpl.matchAll(/\^FO(\d+),(\d+)/g)) {
      expect(Number(m[1])).toBeLessThan(LABEL.width - LABEL.margin);
      expect(Number(m[2])).toBeLessThan(LABEL.height - LABEL.margin);
    }
  });
});

describe("bitmapToGfa", () => {
  it("emits the byte counts, the row width and uppercase hex", () => {
    const bits = new Uint8Array([0xff, 0x80, 0x00, 0x01, 0xaa, 0x55]);
    expect(bitmapToGfa(bits, 12, 3)).toBe("^GFA,6,6,2,FF800001AA55");
  });
  it("rejects short buffers", () => {
    expect(() => bitmapToGfa(new Uint8Array(3), 16, 2)).toThrow(/expected 4 bytes/);
  });
});
