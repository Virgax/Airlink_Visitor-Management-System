import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { db } from "./db";

test.afterAll(async () => db.$disconnect());

/** ICAO check digit (weights 7, 3, 1). */
function cd(s: string): string {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    sum += (c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55) * [7, 3, 1][i % 3]!;
  }
  return String(sum % 10);
}
/** A synthetic Dominican cédula without the digit 6 (FreeMono renders it in a way the OCR-B model misreads). */
function syntheticCedula(): { lines: string[]; number: string; name: string } {
  for (let n = 0; n < 50; n++) {
    const serial = `AB${String(10000000 + n * 1237).slice(0, 8)}`;
    const cedula = `001${String(1000000 + n * 7919).slice(0, 7)}${n % 10}`;
    const l1 = `IDDOM${serial.slice(0, 9)}<${serial.slice(9)}${cd(serial)}<${cedula}<`;
    const head = `900101${cd("900101")}F350101${cd("350101")}DOMS<<<<<<<<<<`;
    const l2 = head + cd(l1.slice(5, 30) + head.slice(0, 7) + head.slice(8, 15) + head.slice(18, 29));
    if (!`${l1}${l2}`.includes("6")) return { lines: [l1, l2, "PEREZ<GOMEZ<<MARIA<ANA".padEnd(30, "<")], number: `${cedula.slice(0, 3)}-${cedula.slice(3, 10)}-${cedula.slice(10)}`, name: "Maria Ana Perez Gomez" };
  }
  throw new Error("no 6-free cédula found");
}
async function renderCard(lines: string[]): Promise<Buffer> {
  const esc = (s: string) => s.replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><rect width="100%" height="100%" fill="#f4f1f6"/>
    <text x="80" y="200" font-family="DejaVu Sans" font-size="30" fill="#333">Registro de nacimiento 223-04-2009-01-00027263</text>
    ${lines.map((l, i) => `<text x="70" y="${620 + i * 80}" font-family="FreeMono" font-size="60" letter-spacing="2" fill="#111">${esc(l)}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
function hasFreeMono(): boolean {
  try {
    return execFileSync("fc-list", { encoding: "utf8" }).includes("FreeMono");
  } catch {
    return false;
  }
}

test("the MRZ reader of the visitor link: closed or unknown links, bad uploads, and a readable cédula", async ({ request }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const host = await db.employee.findFirstOrThrow({ where: { siteId: site.id } });
  const admin = await db.user.findFirstOrThrow({ where: { memberships: { some: { role: "admin" } } } });
  const base = { siteId: site.id, hostEmployeeId: host.id, createdById: admin.id, kind: "visit" as const, validFrom: new Date(Date.now() - 3_600_000), validUntil: new Date(Date.now() + 86_400_000) };
  const open = await db.pass.create({ data: { ...base, visitorName: `Lector MRZ ${stamp}`, token: `mrz${stamp}abcdefghijkl`, status: "active" } });
  const revoked = await db.pass.create({ data: { ...base, visitorName: `Lector MRZ revocado ${stamp}`, token: `mrzr${stamp}abcdefghijk`, status: "revoked" } });
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();

  expect((await request.post(`/api/v/nope${stamp}abcdefghijklmn/mrz`, { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } })).status()).toBe(404);
  expect((await request.post(`/api/v/${revoked.token}/mrz`, { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } })).status()).toBe(409);
  expect((await request.post(`/api/v/${open.token}/mrz`, { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hola") } } })).status()).toBe(400);
  // A plain image with no MRZ: found false, nothing stored.
  const none = await request.post(`/api/v/${open.token}/mrz`, { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } });
  expect(none.status()).toBe(200);
  expect(await none.json()).toEqual({ found: false });

  if (hasFreeMono()) {
    const card = syntheticCedula();
    const res = await request.post(`/api/v/${open.token}/mrz`, { multipart: { file: { name: "cedula.jpg", mimeType: "image/jpeg", buffer: await renderCard(card.lines) } } });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { found: boolean; identity: Record<string, unknown> };
    expect(json.found).toBe(true);
    expect(json.identity).toMatchObject({ docType: "cedula", docNumber: card.number, fullName: card.name, nationality: "DOM", expiryDate: "2035-01-01" });
    expect(json.identity).not.toHaveProperty("lines");
  }
  const after = await db.pass.findUniqueOrThrow({ where: { id: open.id } });
  expect(after.visitorDocHash).toBeNull();
  expect(after.idBackKey).toBeNull();
});
