import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync(process.argv[2], "utf8");
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
for (const [name, size, pad] of [["icon-192.png",192,0],["icon-512.png",512,0],["maskable-512.png",512,64],["apple-touch-icon.png",180,0]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad*2;
  await page.setContent(`<html><body style="margin:0;background:${pad? '#111111':'transparent'};width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${svg.replace(/width="512" height="512"/, `width="${inner}" height="${inner}"`)}</body></html>`);
  await page.screenshot({ path: `${out}/${name}`, omitBackground: !pad });
}
await browser.close();
