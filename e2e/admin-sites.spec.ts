import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers";

test.setTimeout(120_000);

test("admin manages a site: gate, area, policy, company, blacklist and employee directory", async ({ page }) => {
  const stamp = Date.now();
  await loginAsAdmin(page);

  // Site detail: add a gate and an area on Airlink 2
  await page.goto("/admin/sites");
  await expect(page.getByRole("heading", { name: "Sitios" })).toBeVisible();
  await page.locator("li", { hasText: "Airlink 2" }).getByRole("link", { name: "Administrar" }).click();
  await expect(page.getByRole("heading", { name: "Airlink 2" })).toBeVisible();

  await page.getByLabel("Nombre de la puerta").fill(`Portón ${stamp}`);
  await page.getByLabel("Tipo de puerta").selectOption("vehicle");
  await page.getByRole("button", { name: "Agregar puerta" }).click();
  await expect(page.locator("[role=status]")).toContainText("Puerta agregada");
  await expect(page.getByTestId("gates")).toContainText(`Portón ${stamp}`);
  await expect(page.getByTestId("gates").locator("li", { hasText: `Portón ${stamp}` })).toContainText("Vehicular");

  await page.getByLabel("Nombre del área").fill(`Laboratorio ${stamp}`);
  await page.locator("form", { has: page.getByLabel("Nombre del área") }).getByLabel("Restringida").check();
  await page.getByRole("button", { name: "Agregar área" }).click();
  await expect(page.locator("[role=status]")).toContainText("Área agregada");
  const areaRow = page.getByTestId("areas").locator("li", { hasText: `Laboratorio ${stamp}` });
  await expect(areaRow.getByLabel("Restringida")).toBeChecked();
  await expect(areaRow.getByLabel("Requiere acompañante")).not.toBeChecked();

  // Site settings
  await page.getByLabel("Retención de fotos (días)").fill("120");
  await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page.locator("[role=status]")).toContainText("Cambios guardados");
  await expect(page.getByLabel("Retención de fotos (días)")).toHaveValue("120");

  // Policies: vendor now requires approval by security, max 90 min
  await page.goto("/admin/policies");
  await expect(page.getByRole("heading", { name: "Políticas de visita" })).toBeVisible();
  await page.getByRole("link", { name: "Airlink 2" }).click();
  const vendor = page.getByTestId("policy-vendor");
  await vendor.getByLabel("Requiere aprobación").check();
  await vendor.getByLabel("Aprueba").selectOption("security");
  await vendor.getByLabel("Duración máx. (min)").fill("90");
  await vendor.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("[role=status]")).toContainText("Política guardada");
  const vendorAfter = page.getByTestId("policy-vendor");
  await expect(vendorAfter.getByLabel("Requiere aprobación")).toBeChecked();
  await expect(vendorAfter.getByLabel("Aprueba")).toHaveValue("security");
  await expect(vendorAfter.getByLabel("Duración máx. (min)")).toHaveValue("90");
  // Back to defaults so the seed data stays stable for other specs
  await vendorAfter.getByRole("button", { name: "Valores por defecto" }).click();
  await expect(page.locator("[role=status]")).toContainText("restaurada");
  await expect(page.getByTestId("policy-vendor").getByLabel("Requiere aprobación")).not.toBeChecked();

  // Companies
  await page.goto("/admin/companies");
  await page.getByLabel("Nombre de la empresa").fill(`Uptime Services ${stamp}`);
  await page.getByLabel("RNC").fill("1-01-12345-6");
  await page.getByLabel("Tipo").selectOption("contractor");
  await page.getByLabel("Notas").fill("Mantenimiento de aires");
  await page.getByRole("button", { name: "Agregar empresa" }).click();
  await expect(page.locator("[role=status]")).toContainText("Empresa agregada");
  const companyRow = page.getByRole("row", { name: new RegExp(`Uptime Services ${stamp}`) });
  await expect(companyRow).toContainText("Contratista");
  await companyRow.getByRole("button", { name: "Bloquear" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Uptime Services ${stamp}`) })).toContainText("Sí");
  // Duplicate name is rejected
  await page.getByLabel("Nombre de la empresa").fill(`Uptime Services ${stamp}`);
  await page.getByRole("button", { name: "Agregar empresa" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Ya existe una empresa");

  // Blacklist by document (stored as hash, never the full number)
  await page.goto("/admin/blacklist");
  // Digits not present in the entry's name, so we can assert the number is never echoed back.
  const docDigits = String(stamp).split("").reverse().join("").slice(0, 7);
  await page.getByLabel("Cédula o pasaporte").check();
  await page.getByLabel("Número de documento o placa").fill(`001-${docDigits}-1`);
  await page.getByLabel("Nombre (opcional)").fill(`Persona Vetada ${stamp}`);
  await page.getByLabel("Motivo").fill("Intento de ingreso con pase ajeno");
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
  await page.getByRole("button", { name: "Agregar a la lista negra" }).click();
  await expect(page.locator("[role=status]")).toContainText("Entrada agregada");
  const entry = page.getByTestId("blacklist").locator("li", { hasText: `Persona Vetada ${stamp}` });
  await expect(entry).toContainText("Airlink 2");
  await expect(entry).toContainText("Sin vencimiento");
  await expect(entry).not.toContainText(docDigits);
  // Same document again (different formatting) is rejected as a duplicate
  await page.getByLabel("Número de documento o placa").fill(`001${docDigits}1`);
  await page.getByLabel("Motivo").fill("Duplicado");
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
  await page.getByRole("button", { name: "Agregar a la lista negra" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("ya está en la lista negra");
  await entry.getByRole("button", { name: "Quitar" }).click();
  await expect(page.locator("[role=status]")).toContainText("Entrada eliminada");

  // People screen (merged directory): create a manual employee and find it with search
  await page.goto("/admin/people");
  await page.getByText("Agregar persona", { exact: true }).first().click();
  await page.locator("#name").fill(`Pedro Anfitrión ${stamp}`);
  await page.locator("#email").fill(`pedro-${stamp}@airlinkdr.com`);
  await page.locator("#department").fill("IQC");
  await page.locator("#extension").fill("215");
  await page.locator("#siteId").selectOption({ label: "Airlink 3" });
  await page.getByRole("button", { name: "Agregar persona" }).click();
  await expect(page.locator("[role=status]")).toContainText("Persona agregada");

  await page.getByLabel("Buscar persona").fill(`anfitrión ${stamp}`);
  await page.getByRole("button", { name: "Buscar" }).click();
  const empRow = page.getByTestId("person-row").filter({ hasText: `Pedro Anfitrión ${stamp}` });
  await expect(empRow).toBeVisible();
  await expect(empRow).toContainText("Airlink 3");
  await expect(empRow).toContainText("Manual");
  await expect(page.getByText("1 persona", { exact: true })).toBeVisible();

  await page.getByLabel("Buscar persona").fill("departamento-inexistente");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Sin resultados")).toBeVisible();

  // Search by department and deactivate
  await page.getByLabel("Buscar persona").fill(`iqc ${stamp}`);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByTestId("person-row").filter({ hasText: `Pedro Anfitrión ${stamp}` }).getByRole("button", { name: "Desactivar" }).click();
  await expect(page.locator("[role=status]")).toContainText("Cambios guardados");
  await expect(page.getByTestId("person-row").filter({ hasText: `Pedro Anfitrión ${stamp}` })).toContainText("Inactivo");
});
