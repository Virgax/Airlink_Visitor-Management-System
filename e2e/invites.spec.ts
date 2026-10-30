import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "../src/lib/auth/password";
import { signStaticQr } from "../src/lib/passes/validate";
import { db } from "./db";
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
  await page.waitForURL(/\/(app|admin|guard|select-panel)/);
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
  await expect(k.getByRole("heading", { name: "Entrar con PIN" })).toBeVisible();
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

test("security issues an invitation link group for a host; visitors self-register; checkpoint verifies badges", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const [oficinas, produccion] = await Promise.all([
    db.area.findFirstOrThrow({ where: { siteId: site.id, name: "Oficinas" } }),
    db.area.findFirstOrThrow({ where: { siteId: site.id, name: "Producción" } }),
  ]);
  const reception = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  const hostName = `Anfitrión Invitado ${stamp}`;
  const host = await db.employee.create({ data: { name: hostName, email: `host-inv-${stamp}@airlink.test`, department: "Calidad", siteId: site.id, source: "manual" } });
  const secEmail = `sec-inv-${stamp}@airlink.test`;
  const secPassword = `Sec-${stamp}-pass!`;
  const guardName = `Seguridad Invites ${stamp}`;
  await db.user.create({ data: { email: secEmail, name: guardName, passwordHash: await hashPassword(secPassword), pinHash: await hashPassword("2468"), memberships: { create: { role: "security", siteId: site.id } } } });

  // 1. Security (no host membership) opens the host panel and creates a 2-person invitation on behalf of the host.
  await login(page, secEmail, secPassword);
  await page.goto(`/app/passes/new?siteId=${site.id}`);
  await expect(page.getByTestId("host-on-behalf")).toBeVisible();
  await page.locator("#hostEmployeeId").selectOption({ label: `${hostName} · Calidad` });
  await page.getByTestId("self-registration").check();
  await page.getByLabel("Tipo de visita").selectOption("visit");
  await page.getByLabel("Válido desde").fill(localDate(-1, "08:00"));
  await page.getByLabel("Válido hasta").fill(localDate(1, "18:00"));
  await page.getByLabel("Oficinas").check();
  await page.locator("#groupSize").fill("2");
  await page.getByRole("button", { name: "Crear pase" }).click();
  await expect(page).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=createdGroup$/);
  await expect(page.getByTestId("registration-pending")).toBeVisible();
  const links = (await page.getByTestId("group-links").inputValue()).split("\n");
  expect(links).toHaveLength(2);
  const tokens = links.map((l) => l.split("/v/")[1]!);
  const passes = await db.pass.findMany({ where: { token: { in: tokens } }, orderBy: { visitorName: "asc" } });
  expect(passes.map((p) => p.visitorName)).toEqual(["Visitante 1", "Visitante 2"]);
  expect(passes.every((p) => p.selfRegistration && !p.registeredAt && p.hostEmployeeId === host.id)).toBe(true);
  const [pass1, pass2] = passes as [typeof passes[0], typeof passes[0]];

  // 2. No QR until the visitor registers; the API agrees.
  expect((await page.request.get(`/api/v/${pass1.token}/qr`)).status()).toBe(409);
  const v = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await v.goto(`/v/${pass1.token}`);
  await expect(v.getByTestId("qr-register-note")).toBeVisible();
  await expect(v.getByTestId("pass-qr")).toHaveCount(0);
  const form = v.getByTestId("register-form");
  await form.locator("#name").fill("Ana Invitada");
  await form.locator("#doc").fill("001-2222222-2");
  await form.locator("#phone").fill("809-555-0122");
  await form.getByRole("button", { name: "Completar registro" }).click();
  await expect(v.locator("[role=status]")).toContainText("Registro completado");
  await expect(v.getByTestId("pass-qr")).toBeVisible();
  await expect(v.getByTestId("link-locked")).toContainText("Ana Invitada");
  await expect(v.getByTestId("register-form")).toHaveCount(0);
  await expect(v.getByTestId("prereg-form")).toHaveCount(0);
  const registered = await db.pass.findUniqueOrThrow({ where: { id: pass1.id } });
  expect(registered.visitorName).toBe("Ana Invitada");
  expect(registered.registeredAt).not.toBeNull();
  expect(registered.visitorDocLast4).toBe("2222");
  await page.reload();
  await expect(page.getByTestId("registration-done")).toBeVisible();

  // 3. Reception kiosk: the unregistered member is refused, the registered one enters.
  const payloadFor = (id: string) => signStaticQr({ passId: id, exp: Math.floor((Date.now() + 86_400_000) / 1000), siteId: site.id }, SIGNING_KEY);
  const code1 = `IN${stamp.toString(36).toUpperCase().slice(-6)}`;
  await db.guardDevice.create({ data: { siteId: site.id, gateId: reception.id, name: `Kiosk Invites ${stamp}`, enrollCodeHash: sha256(code1), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  const k = await openKiosk(browser, code1, guardName);
  await expect((await scan(k, payloadFor(pass2.id)))).toHaveAttribute("data-reason", "not_registered");
  const entered = await scan(k, payloadFor(pass1.id));
  await expect(entered).toHaveAttribute("data-tone", "ok");
  await expect(entered.getByTestId("result-name")).toHaveText("Ana Invitada");

  // 4. A checkpoint gate upstairs: admin sets the areas it controls; its kiosk only verifies.
  const checkpoint = await db.gate.create({ data: { siteId: site.id, name: `Escalera ${stamp}`, kind: "checkpoint", settings: { checkpointAreaIds: [produccion.id] } } });
  const code2 = `CK${stamp.toString(36).toUpperCase().slice(-6)}`;
  await db.guardDevice.create({ data: { siteId: site.id, gateId: checkpoint.id, name: `Checkpoint ${stamp}`, enrollCodeHash: sha256(code2), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  const c = await openKiosk(browser, code2, guardName);
  await expect(c.getByRole("link", { name: "Visita no anunciada" })).toHaveCount(0);
  await c.goto("/guard/scan");
  await expect(c.getByRole("heading", { name: "Verificar acceso" })).toBeVisible();
  await expect(c.getByTestId("pin-entry")).toHaveCount(0);
  // The visit only has "Oficinas"; this checkpoint controls "Producción".
  const refused = await scan(c, payloadFor(pass1.id));
  await expect(refused).toHaveAttribute("data-reason", "area_not_allowed");
  await expect(refused.getByTestId("result-checkpoint")).toHaveAttribute("data-allowed", "0");
  // Someone who never entered through reception.
  await expect((await scan(c, payloadFor(pass2.id)))).toHaveAttribute("data-reason", "not_inside");

  const admin = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await loginAsAdmin(admin);
  await admin.goto(`/admin/sites/${site.id}`);
  const settings = admin.locator(`[data-gate-name="Escalera ${stamp}"]`).getByTestId("checkpoint-settings");
  await expect(settings).toBeVisible();
  await settings.getByLabel("Oficinas").check();
  await settings.getByLabel("Producción").uncheck();
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(admin).toHaveURL(/ok=saved/);
  const updated = await db.gate.findUniqueOrThrow({ where: { id: checkpoint.id } });
  expect((updated.settings as { checkpointAreaIds: string[] }).checkpointAreaIds).toEqual([oficinas.id]);

  const verified = await scan(c, payloadFor(pass1.id));
  await expect(verified).toHaveAttribute("data-tone", "verified");
  await expect(verified.getByTestId("result-checkpoint")).toHaveAttribute("data-allowed", "1");
  // Verification never changed the visit: still inside, one use consumed at reception only.
  const visit = await db.visit.findFirstOrThrow({ where: { passId: pass1.id } });
  expect(visit.status).toBe("inside");
  expect((await db.pass.findUniqueOrThrow({ where: { id: pass1.id } })).uses).toBe(1);
  expect(await db.auditLog.count({ where: { action: "visit.checkpoint", targetId: visit.id } })).toBe(2);
});
