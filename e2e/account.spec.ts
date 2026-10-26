import { expect, test } from "@playwright/test";
import { totpCode } from "../src/lib/auth/totp";
import { createLocalHost, db } from "./db";

test.afterAll(async () => db.$disconnect());

test("two-step verification can be enrolled and is then required at login", async ({ browser }) => {
  const { email, password } = await createLocalHost(Date.now());

  const ctx = await browser.newContext({ locale: "es-DO" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/app/);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  await page.getByRole("button", { name: "Activar" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Código", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Código incorrecto");
  await page.getByLabel("Código", { exact: true }).fill(totpCode(secret));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("[role=status]")).toContainText("Verificación en dos pasos activada");
  await ctx.close();

  const ctx2 = await browser.newContext({ locale: "es-DO" });
  const p2 = await ctx2.newPage();
  await p2.goto("/login");
  await p2.getByLabel("Correo").fill(email);
  await p2.getByLabel("Contraseña", { exact: true }).fill(password);
  await p2.getByRole("button", { name: "Entrar" }).click();
  await expect(p2.getByLabel("Código de verificación")).toBeVisible();
  await p2.getByLabel("Código de verificación").fill("123456");
  await p2.getByRole("button", { name: "Entrar" }).click();
  await expect(p2.locator("p[role=alert]")).toContainText("Código de verificación incorrecto");
  await p2.getByLabel("Código de verificación").fill(totpCode(secret));
  await p2.getByRole("button", { name: "Entrar" }).click();
  await expect(p2).toHaveURL(/\/app/);
  await ctx2.close();
});
