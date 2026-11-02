import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "../src/lib/auth/password";
import { signStaticQr } from "../src/lib/passes/validate";
import { createLocalHost, db } from "./db";
import { loginAsAdmin } from "./helpers";

test.setTimeout(240_000);
test.afterAll(async () => db.$disconnect());

const SIGNING_KEY = process.env.PASS_SIGNING_KEY!;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|admin|select-panel)/);
}

function localDate(days: number, time: string): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

async function openKiosk(browser: Browser, enrollCode: string, guardName: string): Promise<Page> {
  const k = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await k.goto("/guard");
  await k.getByLabel("Código").fill(enrollCode);
  await k.getByRole("button", { name: "Enrolar" }).click();
  await k.locator("#userId").selectOption({ label: guardName });
  await k.getByLabel("PIN").fill("2468");
  await k.getByRole("button", { name: "Entrar" }).click();
  await expect(k.getByRole("heading", { name: "Modo kiosco" })).toBeVisible();
  return k;
}

async function scan(k: Page, payload: string) {
  await k.goto("/guard/scan");
  await k.getByTestId("manual-payload").fill(payload);
  await k.getByRole("button", { name: "Validar" }).click();
  const result = k.getByTestId("scan-result");
  await expect(result).toBeVisible();
  return result;
}

test("personal devices: HR requires them, host and visitor register IMEIs, kiosk shows, traces and enforces them", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const reception = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  const templateName = `Dispositivos ${stamp}`;

  // 1. HR: a vendor form with a required devices block.
  await loginAsAdmin(page);
  await page.goto("/admin/forms");
  await page.getByLabel("Nombre del formulario").fill(templateName);
  await page.getByLabel("Sitio").selectOption(site.id);
  await page.getByRole("button", { name: "Crear formulario" }).click();
  await page.waitForURL(/\/admin\/forms\/[a-z0-9]+/);
  await page.getByTestId("add-devices").click();
  await page.getByLabel("Etiqueta", { exact: true }).fill("Dispositivos que trae");
  await expect(page.getByTestId("form-preview").getByTestId("devices-field")).toBeVisible();
  await page.getByRole("button", { name: "Guardar formulario" }).click();
  await expect(page.locator("p[role=status]")).toBeVisible();
  await page.goto(`/admin/policies?site=${site.id}`);
  const vendorForm = page.getByTestId("policy-vendor");
  await vendorForm.getByLabel("Formulario de registro").selectOption({ label: templateName });
  await vendorForm.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/ok=saved/);

  // 2. Host registers the visitor's phone on the invite; the visitor adds a laptop from the link.
  const host = await createLocalHost(stamp);
  const h = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await login(h, host.email, host.password);
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("vendor");
  await h.getByLabel("Nombre del visitante").fill(`Proveedor Dispositivos ${stamp}`);
  await h.getByLabel("Cédula o pasaporte").fill("001-1234567-8");
  await h.getByLabel("Válido desde").fill(localDate(-1, "08:00"));
  await h.getByLabel("Válido hasta").fill(localDate(1, "18:00"));
  const hostDevices = h.getByTestId("custom-fields").getByTestId("devices-field");
  await expect(hostDevices).toBeVisible();
  const row = hostDevices.getByTestId("device-row").first();
  await row.locator("select").selectOption("phone");
  await row.locator("input").nth(0).fill("35-123456-789012-3");
  await row.locator("input").nth(1).fill("iPhone 15");
  await row.locator("input").nth(2).fill("negro");
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  await expect(h.getByTestId("pass-devices")).toContainText("351234567890123");
  const token = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
  const pass = await db.pass.findUniqueOrThrow({ where: { token } });

  const v = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await v.goto(`/v/${token}`);
  const vDevices = v.getByTestId("devices-field");
  await expect(vDevices.getByTestId("device-row")).toHaveCount(1);
  await expect(vDevices.getByTestId("device-row").first().locator("input").nth(0)).toHaveValue("351234567890123");
  await vDevices.getByTestId("add-device").click();
  const second = vDevices.getByTestId("device-row").nth(1);
  await second.locator("select").selectOption("laptop");
  await second.locator("input").nth(0).fill("sn-abc123");
  await second.locator("input").nth(1).fill("Dell Latitude");
  await second.locator("input").nth(2).fill("gris");
  await v.getByRole("button", { name: "Guardar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Datos guardados");
  const updated = await db.pass.findUniqueOrThrow({ where: { id: pass.id } });
  expect((updated.extra as { devices: { id: string; kind: string }[] }).devices.map((d) => `${d.kind}:${d.id}`)).toEqual(["phone:351234567890123", "laptop:SNABC123"]);

  // 3. Kiosk: the scan lists the devices; an IMEI typed with spaces finds its owner; an unknown one is refused.
  const guardName = `Guardia Dispositivos ${stamp}`;
  await db.user.create({ data: { email: `guard-dev-${stamp}@airlink.test`, name: guardName, pinHash: await hashPassword("2468"), memberships: { create: { role: "security", siteId: site.id } } } });
  const code = `DV${stamp.toString(36).toUpperCase().slice(-6)}`;
  await db.guardDevice.create({ data: { siteId: site.id, gateId: reception.id, name: `Kiosk Devices ${stamp}`, enrollCodeHash: sha256(code), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  const k = await openKiosk(browser, code, guardName);
  const payloadFor = (id: string) => signStaticQr({ passId: id, exp: Math.floor((Date.now() + 86_400_000) / 1000), siteId: site.id }, SIGNING_KEY);
  const entered = await scan(k, payloadFor(pass.id));
  await expect(entered).toHaveAttribute("data-tone", "ok");
  await expect(entered.getByTestId("result-devices")).toContainText("SNABC123");
  await expect(entered.getByTestId("result-devices").locator("li")).toHaveCount(2);
  const found = await scan(k, "35 123456 789012 3");
  await expect(found).toHaveAttribute("data-tone", "verified");
  await expect(found.getByTestId("result-device")).toHaveAttribute("data-inside", "1");
  await expect(found.getByTestId("result-name")).toContainText(`Proveedor Dispositivos ${stamp}`);
  await expect(await scan(k, "99999999999")).toHaveAttribute("data-reason", "device_not_found");

  // 4. A vendor who registered nothing cannot enter until they register or declare none from the link.
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("vendor");
  await h.getByLabel("Nombre del visitante").fill(`Proveedor Sin Registro ${stamp}`);
  await h.getByLabel("Cédula o pasaporte").fill("001-7654321-0");
  await h.getByLabel("Válido desde").fill(localDate(-1, "08:00"));
  await h.getByLabel("Válido hasta").fill(localDate(1, "18:00"));
  await h.getByTestId("custom-fields").getByTestId("devices-none").check();
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\?ok=created$/);
  const token2 = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
  const pass2 = await db.pass.findUniqueOrThrow({ where: { token: token2 } });
  // Simulate a pass created before the rule existed: strip the declaration.
  await db.pass.update({ where: { id: pass2.id }, data: { extra: {} } });
  await expect(await scan(k, payloadFor(pass2.id))).toHaveAttribute("data-reason", "devices_required");
  await v.goto(`/v/${token2}`);
  await v.getByTestId("devices-none").check();
  await v.getByRole("button", { name: "Guardar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Datos guardados");
  const ok = await scan(k, payloadFor(pass2.id));
  await expect(ok).toHaveAttribute("data-tone", "ok");
  await expect(ok.getByTestId("result-devices")).toContainText("no trae");

  // Leave the vendor policy as it was.
  await db.visitPolicy.update({ where: { siteId_kind: { siteId: site.id, kind: "vendor" } }, data: { formTemplateId: null } });
});
