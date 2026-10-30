import { expect, test } from "@playwright/test";
import { HELP_GUIDES } from "../src/lib/help/guides";

test("help index and guides are public, list every guide and load their screenshots", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Ayuda" })).toBeVisible();
  await expect(page.getByTestId("help-guides").locator("li")).toHaveCount(HELP_GUIDES.length);

  await page.getByRole("link", { name: "Activar un kiosco de seguridad" }).first().click();
  await expect(page).toHaveURL(/\/help\/kiosk-setup$/);
  await expect(page.getByRole("heading", { name: "Activar un kiosco de seguridad" })).toBeVisible();
  const guide = HELP_GUIDES.find((g) => g.slug === "kiosk-setup")!;
  await expect(page.getByTestId("help-steps").locator("> li")).toHaveCount(guide.steps.length);
  const shots = page.getByTestId("help-shot");
  await expect(shots).toHaveCount(guide.steps.filter((s) => s.shot).length);
  // Lazy images: scroll them into view and make sure each one actually decoded.
  for (const img of await shots.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await expect(page.getByRole("link", { name: /Siguiente guía/ })).toBeVisible();

  // Unknown guides 404; the kiosk home and the devices page link to the guides.
  const missing = await page.request.get("/help/no-such-guide");
  expect(missing.status()).toBe(404);
  await page.goto("/admin/devices");
  await expect(page).toHaveURL(/\/login/);
});
