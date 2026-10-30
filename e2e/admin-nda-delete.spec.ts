import { expect, test } from "@playwright/test";
import { db } from "./db";
import { loginAsAdmin } from "./helpers";

test.afterAll(async () => db.$disconnect());

test("admin publishes a bilingual visitor policy; visitors read it in their language; sites and gates can be deleted", async ({ browser, page }) => {
  const stamp = Date.now();
  await loginAsAdmin(page);

  // 1. A temporary site (deleted at the end, so nothing this test publishes outlives it).
  await page.goto("/admin/sites");
  await page.getByLabel("Nombre del sitio").fill(`Temporal ${stamp}`);
  await page.getByLabel("Identificador (URL)").fill(`temporal-${stamp}`);
  await page.getByRole("button", { name: "Crear sitio" }).click();
  await expect(page).toHaveURL(/\/admin\/sites\/[a-z0-9]+\?ok=created/);
  await expect(page.getByRole("heading", { name: `Temporal ${stamp}` })).toBeVisible();
  const temp = await db.site.findUniqueOrThrow({ where: { slug: `temporal-${stamp}` } });

  // 2. Visitor policy: a new version for that site, with English text.
  await page.goto("/admin/nda");
  await expect(page.getByRole("heading", { name: "Política de visitantes (NDA)" })).toBeVisible();
  const version = `9.${stamp % 100000}`;
  await page.locator("#siteId").selectOption(temp.id);
  await page.locator("#version").fill(version);
  await page.locator("#title").fill(`Política de visitantes ${stamp}`);
  await page.locator("#body").fill("Al ingresar acepto portar el gafete visible, no tomar fotografías y seguir las indicaciones de Seguridad.");
  await page.locator("#titleEn").fill(`Visitor policy ${stamp}`);
  await page.locator("#bodyEn").fill("By entering I agree to wear the badge visibly, take no photographs and follow Security's instructions.");
  await page.getByRole("button", { name: "Publicar versión" }).click();
  await expect(page.locator("[role=status]")).toContainText("Versión publicada");
  const row = page.locator(`[data-testid=nda-version][data-version="${version}"]`);
  await expect(row).toContainText("Vigente");
  await expect(row).toContainText("EN");
  const nda = await db.ndaVersion.findFirstOrThrow({ where: { version, siteId: temp.id } });
  expect(nda.bodyEn).toContain("wear the badge");
  expect(await db.auditLog.count({ where: { action: "nda.published", targetId: nda.id } })).toBe(1);

  // A contractor pass (NDA required) shows the policy in the visitor's language.
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const host = await db.employee.create({ data: { name: `Host NDA ${stamp}`, siteId: temp.id, source: "manual" } });
  const admin = await db.user.findFirstOrThrow({ where: { memberships: { some: { role: "admin" } } } });
  const pass = await db.pass.create({ data: { siteId: temp.id, hostEmployeeId: host.id, createdById: admin.id, kind: "contractor", visitorName: `Contratista ${stamp}`, validFrom: new Date(Date.now() - 3_600_000), validUntil: new Date(Date.now() + 86_400_000), token: `nda${stamp}abcdefghijkl`, status: "active" } });
  const es = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await es.goto(`/v/${pass.token}`);
  await expect(es.getByTestId("nda-title")).toContainText(`Política de visitantes ${stamp}`);
  await es.locator("#locale-select").selectOption("en");
  await es.getByRole("button", { name: "OK" }).click();
  await expect(es.getByTestId("nda-title")).toContainText(`Visitor policy ${stamp}`);
  await expect(es.getByTestId("nda-body")).toContainText("wear the badge");

  // 3. An unused gate can be deleted; the site is deleted after typing its name.
  await page.goto(`/admin/sites/${temp.id}`);
  await page.getByLabel("Nombre de la puerta").fill("Portón pruebas");
  await page.getByRole("button", { name: "Agregar puerta" }).click();
  const gateRow = page.locator('[data-gate-name="Portón pruebas"]');
  await expect(gateRow).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await gateRow.getByTestId("delete-gate").click();
  await expect(page.locator("[role=status]")).toContainText("Puerta eliminada");
  await expect(page.locator('[data-gate-name="Portón pruebas"]')).toHaveCount(0);

  // A gate with visits (Airlink 2 · Recepción) offers no delete button.
  const reception = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  await db.visit.create({ data: { siteId: site.id, gateId: reception.id, visitorName: `Visita ${stamp}`, kind: "visit", status: "left", hostEmployeeId: host.id, requestedById: admin.id } });
  await page.goto(`/admin/sites/${site.id}`);
  await expect(page.locator('[data-gate-name="Recepción"]').getByTestId("delete-gate")).toHaveCount(0);

  await page.goto(`/admin/sites/${temp.id}`);
  await page.locator("#confirmName").fill("otro nombre");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-site-button").click();
  await expect(page.locator("p[role=alert]")).toContainText("no coincide");
  await page.locator("#confirmName").fill(`Temporal ${stamp}`);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-site-button").click();
  await expect(page).toHaveURL(/\/admin\/sites\?ok=deleted/);
  await expect(page.locator("[role=status]")).toContainText("Sitio eliminado");
  expect(await db.site.findUnique({ where: { id: temp.id } })).toBeNull();
  expect(await db.auditLog.count({ where: { action: "site.deleted", targetId: temp.id } })).toBe(1);
});
