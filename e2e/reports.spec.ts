import { readFileSync } from "node:fs";
import { expect, test, type Download } from "@playwright/test";
import { db } from "./db";
import { loginAsAdmin } from "./helpers";
import { hashPassword } from "../src/lib/auth/password";
import { localParts } from "../src/lib/time/tz";

test.setTimeout(150_000);

async function csvLines(download: Download): Promise<string[]> {
  const path = await download.path();
  const text = readFileSync(path!, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return text.slice(1).split("\r\n").filter((l) => l !== "");
}

test("visits and shift-log reports: filters, CSV export, dashboard counts and kiosk shift log", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  const host = await db.employee.create({ data: { name: `Host E2E ${stamp}`, email: `host-e2e-${stamp}@airlink.test`, siteId: site.id } });
  const company = await db.company.create({ data: { name: `Empresa E2E ${stamp}`, kind: "vendor" } });
  const guard = await db.user.create({
    data: { email: `guardia-e2e-${stamp}@airlink.test`, name: `Guardia E2E ${stamp}`, pinHash: await hashPassword("1357"), memberships: { create: { role: "security", siteId: site.id } } },
  });
  const now = new Date();
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  await db.visit.createMany({
    data: [
      { siteId: site.id, gateId: gate.id, hostEmployeeId: host.id, companyId: company.id, visitorName: `Visitante Uno ${stamp}`, kind: "vendor", status: "left", requestedById: guard.id, enteredAt: minutesAgo(8), leftAt: minutesAgo(3) },
      { siteId: site.id, gateId: gate.id, hostEmployeeId: host.id, companyId: company.id, visitorName: `Visitante Dos ${stamp}`, kind: "contractor", status: "inside", requestedById: guard.id, enteredAt: minutesAgo(2), areaIds: [] },
      { siteId: site.id, gateId: gate.id, hostEmployeeId: host.id, visitorName: `Visitante Tres ${stamp}`, kind: "visit", status: "pending", requestedById: guard.id },
    ],
  });
  const today = localParts(now, site.timezone).ymd;
  const hostQuery = `host=${encodeURIComponent(`Host E2E ${stamp}`)}`;

  await loginAsAdmin(page);

  // Visits report filtered by date + host
  await page.goto(`/admin/reports?from=${today}&to=${today}&${hostQuery}`);
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(page.getByTestId("visit-total")).toHaveText("3");
  const table = page.getByTestId("visits-table");
  await expect(table).toContainText(`Visitante Uno ${stamp}`);
  await expect(table).toContainText(`Empresa E2E ${stamp}`);
  await expect(table).toContainText("5 min");

  // Kind filter narrows it down
  await page.goto(`/admin/reports?from=${today}&to=${today}&${hostQuery}&kind=contractor`);
  await expect(page.getByTestId("visit-total")).toHaveText("1");
  await expect(page.getByTestId("visits-table")).not.toContainText(`Visitante Uno ${stamp}`);

  // CSV export with the same filters
  await page.goto(`/admin/reports?from=${today}&to=${today}&${hostQuery}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const lines = await csvLines(download);
  expect(lines[0]).toBe("Fecha;Visitante;Cédula (últimos 4);Placa;Empresa;Anfitrión;Tipo;Sitio;Puerta;Estado;Entrada;Salida;Duración (min);Gafete;Acompañante");
  expect(lines).toHaveLength(4);
  expect(lines.some((l) => l.includes(`Visitante Uno ${stamp};;;Empresa E2E ${stamp};Host E2E ${stamp};Proveedor;Airlink 2;Recepción;Salió;`))).toBe(true);

  // Audit report
  await page.goto(`/admin/reports/audit?from=${today}&to=${today}&${hostQuery}`);
  await expect(page.getByTestId("audit-table")).toContainText(`Visitante Dos ${stamp}`);
  const [auditDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const auditLines = await csvLines(auditDownload);
  expect(auditLines[0]).toContain(";Versión NDA;NDA aceptado el;");
  expect(auditLines).toHaveLength(4);

  // Dashboard shows today's counters per site
  await page.goto("/admin");
  await expect(page.getByTestId("dashboard-today")).toContainText("Airlink 2");
  await expect(page.getByTestId("dashboard-today")).toContainText("Dentro ahora");

  // Kiosk: enroll a device at Airlink 2 and sign in with the guard's PIN
  await page.goto("/admin/devices");
  await page.getByLabel("Nombre del dispositivo").fill(`Tablet Log ${stamp}`);
  await page.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
  await page.getByLabel("Puerta").selectOption({ label: "Airlink 2 · Recepción" });
  await page.getByRole("button", { name: "Crear dispositivo" }).click();
  const code = (await page.getByTestId("enroll-code").textContent())!.trim();

  const kiosk = await browser.newContext({ locale: "es-DO" });
  const k = await kiosk.newPage();
  await k.goto("/guard/log");
  await expect(k).toHaveURL(/\/guard$/); // no device cookie → back to enrollment
  await k.getByLabel("Código").fill(code);
  await k.getByRole("button", { name: "Enrolar" }).click();
  await k.locator("#userId").selectOption({ label: `Guardia E2E ${stamp}` });
  await k.getByLabel("PIN").fill("1357");
  await k.getByRole("button", { name: "Entrar" }).click();
  await expect(k.getByRole("heading", { name: "Modo kiosco" })).toBeVisible();

  await k.getByRole("link", { name: "Bitácora" }).click();
  await expect(k.getByRole("heading", { name: "Bitácora de turno" })).toBeVisible();
  await k.getByLabel("Tipo").selectOption("incident");
  await k.getByLabel("Descripción").fill(`Incidente E2E ${stamp}: portón trasero abierto`);
  await k.getByRole("button", { name: "Guardar entrada" }).click();
  await expect(k.locator("[role=status]")).toContainText("Entrada guardada");
  await expect(k.getByTestId("shift-log-list")).toContainText(`Incidente E2E ${stamp}`);
  await expect(k.getByTestId("shift-log-list")).toContainText(`Guardia E2E ${stamp}`);
  await kiosk.close();

  // The entry shows up in the shift-log report and its CSV
  const guardQuery = `guard=${encodeURIComponent(`Guardia E2E ${stamp}`)}`;
  await page.goto(`/admin/reports/shifts?from=${today}&to=${today}&${guardQuery}`);
  await expect(page.getByTestId("shifts-table")).toContainText(`Incidente E2E ${stamp}`);
  await expect(page.getByTestId("shifts-table")).toContainText("Incidente");
  const [shiftDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const shiftLines = await csvLines(shiftDownload);
  expect(shiftLines[0]).toBe("Hora;Sitio;Puerta;Guardia;Tipo;Texto;Foto");
  expect(shiftLines).toHaveLength(2);
  expect(shiftLines[1]).toContain(`Airlink 2;Recepción;Guardia E2E ${stamp};Incidente;Incidente E2E ${stamp}: portón trasero abierto;`);

  // Dashboard now counts the incident
  await page.goto("/admin");
  await expect(page.getByTestId("dashboard-today")).toContainText("Incidentes hoy");
  await expect(db.auditLog.count({ where: { action: "shift.incident", actorId: guard.id } })).resolves.toBe(1);
});
