import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

const widths = [280, 360, 768, 1280];
const publicPages = ["/login", "/legal/privacidad", "/v/this-token-does-not-exist-0000"];

for (const width of widths) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of publicPages) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
    await loginAsAdmin(page);
    for (const path of ["/select-panel", "/admin", "/admin/sites", "/admin/policies", "/admin/people", "/admin/frequent", "/admin/companies", "/admin/blacklist", "/admin/devices", "/admin/reports/invites", "/app/evacuacion", "/account"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
