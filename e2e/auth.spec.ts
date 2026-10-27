import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, loginAsAdmin } from "./helpers";

test("login page renders in Spanish and rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Correo o contraseña incorrectos");
});

test("protected routes redirect to login; the kiosk page does not", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto("/guard");
  await expect(page.getByRole("heading", { name: "Enrolar este dispositivo" })).toBeVisible();
});

test("admin signs in, lands on the admin panel and signs out", async ({ page }) => {
  await loginAsAdmin(page);
  if (page.url().includes("select-panel")) {
    await page.getByRole("button", { name: "Abrir" }).first().click();
  }
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await expect(page.getByText("Airlink 2").first()).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("english locale switch", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#locale-select").selectOption("en");
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
