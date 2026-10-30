import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createLocalHost, db } from "./db";
import { ADMIN_EMAIL, loginAsAdmin } from "./helpers";
import { localParts } from "../src/lib/time/tz";

test.afterAll(async () => {
  // Leave the seeded vendor policy as other specs expect it (default form) and retire the templates made here.
  await db.visitPolicy.updateMany({ where: { formTemplate: { name: { contains: " E2E " } } }, data: { formTemplateId: null } });
  await db.formTemplate.updateMany({ where: { name: { contains: " E2E " } }, data: { active: false } });
  await db.$disconnect();
});
test.setTimeout(180_000);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|guard|select-panel)/);
}

function localDate(days: number, time: string): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

test("HR builds a form template, assigns it to vendors; host, visitor and CSV use it", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  const templateName = `Proveedores E2E ${stamp}`;
  const selectLabel = `Modelo de equipo ${stamp}`;
  const checkboxLabel = `Acepto normas ${stamp}`;

  // 1. Admin creates the template and builds it in the editor.
  await loginAsAdmin(page);
  await page.goto("/admin/forms");
  await expect(page.getByRole("heading", { name: "Formularios de registro" })).toBeVisible();
  await page.getByLabel("Nombre del formulario").fill(templateName);
  await page.getByLabel("Sitio").selectOption(site.id);
  await page.getByRole("button", { name: "Crear formulario" }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/[a-z0-9]+\?ok=created$/);
  const templateId = page.url().split("/admin/forms/")[1]!.split("?")[0]!;

  // Select question shown to the host only.
  await page.getByTestId("add-question").click();
  await page.getByLabel("Etiqueta", { exact: true }).fill(selectLabel);
  await page.getByLabel("Tipo de respuesta").selectOption("select");
  await page.getByLabel("Opciones").fill("iPhone\nSamsung");
  await page.getByLabel("Obligatorio", { exact: true }).check();
  await page.getByLabel("Enlace del visitante").uncheck();
  await page.getByLabel("Kiosco").uncheck();
  // Required checkbox shown to the visitor only.
  await page.getByTestId("add-question").click();
  await page.getByLabel("Etiqueta", { exact: true }).fill(checkboxLabel);
  await page.getByLabel("Tipo de respuesta").selectOption("checkbox");
  await page.getByLabel("Obligatorio", { exact: true }).check();
  await page.getByLabel("Invitación del anfitrión").uncheck();
  await page.getByLabel("Kiosco").uncheck();
  await expect(page.getByTestId("element-list").locator("li")).toHaveCount(2);
  // Preview shows the visitor surface by default: the checkbox, not the select.
  const preview = page.getByTestId("form-preview");
  await expect(preview.getByText(checkboxLabel)).toBeVisible();
  await expect(preview.getByText(selectLabel)).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar formulario" }).click();
  await expect(page).toHaveURL(/\?ok=saved$/);
  const saved = await db.formTemplate.findUniqueOrThrow({ where: { id: templateId } });
  expect(saved.elements).toHaveLength(2);
  expect(await db.auditLog.count({ where: { action: "form.changed", targetId: templateId } })).toBeGreaterThanOrEqual(2);

  // 2. Assign it to the vendor kind of Airlink 2.
  await page.goto(`/admin/policies?site=${site.id}`);
  const vendorForm = page.getByTestId("policy-vendor");
  await vendorForm.getByLabel("Formulario de registro").selectOption({ label: templateName });
  await vendorForm.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/ok=saved/);
  const policy = await db.visitPolicy.findUniqueOrThrow({ where: { siteId_kind: { siteId: site.id, kind: "vendor" } } });
  expect(policy.formTemplateId).toBe(templateId);
  await page.goto("/admin/forms");
  const card = page.getByTestId("form-template").filter({ hasText: templateName });
  await expect(card.getByTestId("used-by")).toContainText("Proveedor (Airlink 2)");

  // 3. Host creates a vendor pass answering the select.
  const host = await createLocalHost(stamp);
  const hostCtx = await browser.newContext({ locale: "es-DO" });
  const h = await hostCtx.newPage();
  await login(h, host.email, host.password);
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("vendor");
  await h.getByLabel("Nombre del visitante").fill(`Proveedor ${stamp}`);
  await h.getByLabel("Cédula o pasaporte").fill("001-1234567-8");
  await h.getByLabel("Válido desde").fill(localDate(-1, "09:00"));
  await h.getByLabel("Válido hasta").fill(localDate(2, "18:00"));
  await expect(h.getByLabel(selectLabel, { exact: false })).toBeVisible();
  await h.getByLabel(selectLabel, { exact: false }).selectOption("Samsung");
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  const detailUrl = h.url().split("?")[0]!;
  const answers = h.getByTestId("pass-answers");
  await expect(answers).toContainText(selectLabel);
  await expect(answers).toContainText("Samsung");
  const token = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
  const pass = await db.pass.findUniqueOrThrow({ where: { token } });
  expect(pass.extra).toMatchObject({ answers: { question1: { label: selectLabel, value: "Samsung" } } });

  // 4. Visitor link shows the checkbox and refuses to pre-register without it.
  const visitorCtx = await browser.newContext({ locale: "es-DO" });
  const v = await visitorCtx.newPage();
  await v.goto(`/v/${token}`);
  const checkbox = v.getByLabel(checkboxLabel, { exact: false });
  await expect(checkbox).toBeVisible();
  await expect(v.getByText(selectLabel)).toHaveCount(0); // host-only question never reaches the visitor
  // Bypass the browser's own validation to prove the server enforces it.
  await checkbox.evaluate((el) => ((el as HTMLInputElement).required = false));
  await v.getByLabel("Teléfono").fill("809-555-0199");
  await v.getByRole("button", { name: "Guardar" }).click();
  await expect(v.locator("p[role=alert]")).toContainText("Faltan respuestas obligatorias");
  expect((await db.pass.findUniqueOrThrow({ where: { token } })).visitorPhone).toBeNull();
  await v.getByLabel(checkboxLabel, { exact: false }).check();
  await v.getByLabel("Teléfono").fill("809-555-0199");
  await v.getByRole("button", { name: "Guardar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Datos guardados");
  const updated = await db.pass.findUniqueOrThrow({ where: { token } });
  expect(updated.visitorPhone).toBe("809-555-0199");
  expect(updated.extra).toMatchObject({ answers: { question1: { value: "Samsung" }, question2: { label: checkboxLabel, value: true } } });

  // 5. Pass detail shows both answers.
  await h.goto(detailUrl);
  await expect(h.getByTestId("pass-answers")).toContainText(selectLabel);
  await expect(h.getByTestId("pass-answers")).toContainText(checkboxLabel);
  await expect(h.getByTestId("pass-answers").locator("[data-answer=question2] dd")).toHaveText("Sí");

  // 6. A visit carrying the answers (as the kiosk scan copies them) exports them as CSV columns.
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  await db.visit.create({
    data: {
      siteId: site.id, gateId: gate.id, passId: pass.id, hostEmployeeId: pass.hostEmployeeId, visitorName: pass.visitorName, kind: "vendor", status: "inside",
      requestedById: admin.id, enteredAt: new Date(), extra: updated.extra ?? undefined,
    },
  });
  const today = localParts(new Date(), site.timezone).ymd;
  await page.goto(`/admin/reports?from=${today}&to=${today}&host=${encodeURIComponent(`Host ${stamp}`)}`);
  await expect(page.getByTestId("visit-total")).toHaveText("1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const text = readFileSync((await download.path())!, "utf8").slice(1);
  const lines = text.split("\r\n").filter(Boolean);
  expect(lines[0]).toBe(`Fecha;Visitante;Cédula (últimos 4);Placa;Empresa;Anfitrión;Tipo;Sitio;Puerta;Estado;Entrada;Salida;Duración (min);Gafete;Acompañante;${selectLabel};${checkboxLabel}`);
  expect(lines[1]!.endsWith(";Samsung;Sí")).toBe(true);

  await Promise.all([hostCtx.close(), visitorCtx.close()]);
});

test("a signature element replaces the typed-name NDA acceptance with a drawn signature", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const templateName = `Firma E2E ${stamp}`;

  await loginAsAdmin(page);
  await page.goto("/admin/forms");
  await page.getByLabel("Nombre del formulario").fill(templateName);
  await page.getByLabel("Sitio").selectOption(site.id);
  await page.getByRole("button", { name: "Crear formulario" }).click();
  await expect(page).toHaveURL(/\?ok=created$/);
  await page.getByTestId("add-signature").click();
  await page.getByLabel("Etiqueta", { exact: true }).fill("Firma del contratista");
  await expect(page.getByTestId("form-preview").getByTestId("signature-pad")).toBeVisible();
  await page.getByRole("button", { name: "Guardar formulario" }).click();
  await expect(page).toHaveURL(/\?ok=saved$/);
  await page.goto(`/admin/policies?site=${site.id}`);
  const contractorForm = page.getByTestId("policy-contractor");
  await contractorForm.getByLabel("Formulario de registro").selectOption({ label: templateName });
  await contractorForm.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/ok=saved/);

  const host = await createLocalHost(`${stamp}s`);
  const hostCtx = await browser.newContext({ locale: "es-DO" });
  const h = await hostCtx.newPage();
  await login(h, host.email, host.password);
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("contractor");
  await h.getByLabel("Nombre del visitante").fill(`Contratista ${stamp}`);
  await h.getByLabel("Cédula o pasaporte").fill("402-9876543-1");
  await h.getByLabel("Teléfono del visitante").fill("809-555-0100");
  await h.getByLabel("Válido desde").fill(localDate(1, "09:00"));
  await h.getByLabel("Válido hasta").fill(localDate(2, "18:00"));
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\?ok=created$/);
  const token = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;

  const visitorCtx = await browser.newContext({ locale: "es-DO" });
  const v = await visitorCtx.newPage();
  await v.goto(`/v/${token}`);
  await expect(v.getByRole("heading", { name: "Política de visitantes", exact: true })).toBeVisible();
  await expect(v.getByText("Firma del contratista")).toBeVisible();
  await v.getByLabel("He leído y acepto la política de visitantes").check();
  const canvas = v.getByTestId("signature-canvas");
  const box = (await canvas.boundingBox())!;
  await v.mouse.move(box.x + 20, box.y + 80);
  await v.mouse.down();
  await v.mouse.move(box.x + 120, box.y + 40, { steps: 10 });
  await v.mouse.move(box.x + 220, box.y + 110, { steps: 10 });
  await v.mouse.up();
  await expect(v.getByText("Firma registrada.")).toBeVisible();
  await v.getByRole("button", { name: "Aceptar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Política aceptada");
  const pass = await db.pass.findUniqueOrThrow({ where: { token } });
  expect(pass.ndaAcceptedAt).toBeTruthy();
  const entry = await db.auditLog.findFirstOrThrow({ where: { action: "nda.accepted", targetId: pass.id } });
  expect(entry.meta).toMatchObject({ signature: "drawn", signatureHash: expect.stringMatching(/^[a-f0-9]{64}$/) });

  await Promise.all([hostCtx.close(), visitorCtx.close()]);
});
