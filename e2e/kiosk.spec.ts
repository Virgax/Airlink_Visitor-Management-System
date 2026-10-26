import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

test.setTimeout(120_000);

test("admin creates a guard with PIN, enrolls a kiosk, guard signs in with PIN; other site cannot", async ({ browser, page }) => {
  const stamp = Date.now();
  await loginAsAdmin(page);

  // Guard for Airlink 2
  await page.goto("/admin/members");
  await page.getByLabel("Correo").fill(`guardia-${stamp}@airlink.test`);
  await page.getByLabel("Nombre").fill(`Guardia ${stamp}`);
  await page.getByLabel("Rol").selectOption("security");
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
  await page.getByLabel(/PIN inicial/).fill("2468");
  await page.getByRole("button", { name: "Agregar rol" }).click();
  await expect(page.locator("[role=status]")).toContainText("Rol agregado");

  // Kiosk device at Airlink 3 (guard above must NOT appear there)
  await page.goto("/admin/devices");
  await page.getByLabel("Nombre del dispositivo").fill(`Tablet A3 ${stamp}`);
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 3" });
  await page.getByLabel("Puerta").selectOption({ label: "Airlink 3 · Recepción" });
  await page.getByRole("button", { name: "Crear dispositivo" }).click();
  const codeA3 = (await page.getByTestId("enroll-code").textContent())!.trim();

  const kioskA3 = await browser.newContext({ locale: "es-DO" });
  const k3 = await kioskA3.newPage();
  await k3.goto("/guard");
  await k3.getByLabel("Código").fill(codeA3);
  await k3.getByRole("button", { name: "Enrolar" }).click();
  await expect(k3.getByRole("heading", { name: "Entrar con PIN" })).toBeVisible();
  // The Airlink 2 guard must not be offered at an Airlink 3 kiosk (site isolation).
  await expect(k3.getByText(`Guardia ${stamp}`)).toHaveCount(0);
  await kioskA3.close();

  // Kiosk device at Airlink 2
  await page.goto("/admin/devices");
  await page.getByLabel("Nombre del dispositivo").fill(`Tablet A2 ${stamp}`);
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
  await page.getByLabel("Puerta").selectOption({ label: "Airlink 2 · Recepción" });
  await page.getByRole("button", { name: "Crear dispositivo" }).click();
  const codeA2 = (await page.getByTestId("enroll-code").textContent())!.trim();

  const kioskA2 = await browser.newContext({ locale: "es-DO" });
  const k2 = await kioskA2.newPage();
  await k2.goto("/guard");
  await k2.getByLabel("Código").fill("WRONG1");
  await k2.getByRole("button", { name: "Enrolar" }).click();
  await expect(k2.locator("p[role=alert]")).toContainText("Código inválido");
  await k2.getByLabel("Código").fill(codeA2);
  await k2.getByRole("button", { name: "Enrolar" }).click();

  await k2.locator("#userId").selectOption({ label: `Guardia ${stamp}` });
  await k2.getByLabel("PIN").fill("0000");
  await k2.getByRole("button", { name: "Entrar" }).click();
  await expect(k2.locator("p[role=alert]")).toContainText("PIN incorrecto");
  await k2.locator("#userId").selectOption({ label: `Guardia ${stamp}` });
  await k2.getByLabel("PIN").fill("2468");
  await k2.getByRole("button", { name: "Entrar" }).click();
  await expect(k2.getByRole("heading", { name: "Modo kiosco" })).toBeVisible();
  await expect(k2.getByText(`Sesión: Guardia ${stamp}`)).toBeVisible();

  // Code is single-use
  const kioskAgain = await browser.newContext({ locale: "es-DO" });
  const k2b = await kioskAgain.newPage();
  await k2b.goto("/guard");
  await k2b.getByLabel("Código").fill(codeA2);
  await k2b.getByRole("button", { name: "Enrolar" }).click();
  await expect(k2b.locator("p[role=alert]")).toContainText("Código inválido");
  await kioskAgain.close();

  await k2.getByRole("button", { name: "Bloquear" }).click();
  await expect(k2.getByRole("heading", { name: "Entrar con PIN" })).toBeVisible();
  await kioskA2.close();
});
