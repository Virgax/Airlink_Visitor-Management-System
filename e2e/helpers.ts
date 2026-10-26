import type { Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@airlink.test";
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";

export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(admin|select-panel)/);
  await page.waitForLoadState("networkidle");
}
