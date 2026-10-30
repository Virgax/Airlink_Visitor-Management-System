/**
 * Regenerates the screenshots used by /help (public/help/*.png).
 *
 * Run against a server started on a FRESH, seeded database so the pictures only contain demo data:
 *   createdb visitas_help && DATABASE_URL=... npm run db:deploy && DATABASE_URL=... npm run db:seed
 *   DATABASE_URL=... PORT=3100 npm run start &
 *   DATABASE_URL=... HELP_BASE_URL=http://localhost:3100 npm run help:screenshots
 *
 * Demo people and passes are created through Prisma + the UI (idempotent by e-mail). Each screenshot is
 * wrapped so one broken flow does not stop the others; missing shots are listed at the end.
 */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { helpShots } from "../src/lib/help/guides";

const BASE = process.env.HELP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const OUT = join(process.cwd(), "public", "help");
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@airlink.test";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!";
const DESKTOP = { width: 1280, height: 800 };
const KIOSK = { width: 1024, height: 768 };

const db = new PrismaClient();
const done = new Set<string>();
const failed: string[] = [];

const HOST = { email: "demo-host@airlink.test", name: "Laura Méndez", password: "Demo-host-1234!" };
const GUARD = { email: "demo-guard@airlink.test", name: "Carlos Reyes", password: "Demo-guard-1234!", pin: "2468" };

function localDate(days: number, time: string): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: opts.fullPage ?? false, animations: "disabled" });
  done.add(name);
  console.log(`[help] ${name}.png`);
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    failed.push(name);
    console.error(`[help] FAILED ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|admin|guard|select-panel)/);
  await page.waitForLoadState("networkidle");
}

async function seedDemo() {
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

  // Hosts (employees) with realistic names; the first one also signs in as a host + fire warden.
  const employees = [
    { email: HOST.email, name: HOST.name, department: "Calidad", extension: "214" },
    { email: "demo-juan@airlink.test", name: "Juan Pérez", department: "Logística", extension: "118" },
    { email: "demo-maria@airlink.test", name: "María García", department: "Recursos Humanos", extension: "102" },
    { email: "demo-jose@airlink.test", name: "José Martínez", department: "Producción", extension: "330" },
  ];
  for (const e of employees) {
    await db.employee.upsert({ where: { email: e.email }, create: { ...e, siteId: site.id, source: "manual" }, update: { name: e.name, department: e.department } });
  }
  const hostEmployee = await db.employee.findUniqueOrThrow({ where: { email: HOST.email } });
  const hostUser = await db.user.upsert({
    where: { email: HOST.email },
    create: { email: HOST.email, name: HOST.name, employeeId: hostEmployee.id, passwordHash: await hashPassword(HOST.password) },
    update: { employeeId: hostEmployee.id },
  });
  for (const role of ["host", "warden"] as const) {
    const m = await db.membership.findFirst({ where: { userId: hostUser.id, role, siteId: site.id } });
    if (!m) await db.membership.create({ data: { userId: hostUser.id, role, siteId: site.id } });
  }
  const guardUser = await db.user.upsert({
    where: { email: GUARD.email },
    create: { email: GUARD.email, name: GUARD.name, passwordHash: await hashPassword(GUARD.password), pinHash: await hashPassword(GUARD.pin) },
    update: { pinHash: await hashPassword(GUARD.pin) },
  });
  const sec = await db.membership.findFirst({ where: { userId: guardUser.id, role: "security", siteId: site.id } });
  if (!sec) await db.membership.create({ data: { userId: guardUser.id, role: "security", siteId: site.id } });

  for (const name of ["Tecnología Móvil SRL", "Transporte Caribe", "Servicios Eléctricos del Este"]) {
    const c = await db.company.findFirst({ where: { name } });
    if (!c) await db.company.create({ data: { name, kind: name.startsWith("Transporte") ? "carrier" : "vendor" } });
  }
  // Demo devices from previous runs would pile up on the devices page.
  await db.guardDevice.deleteMany({ where: { name: "Tablet Recepción A2" } });
  return { site, hostEmployee, hostUser, guardUser, admin };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const demo = await seedDemo();
  const browser: Browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const ctx = async (viewport = DESKTOP): Promise<BrowserContext> =>
    browser.newContext({ baseURL: BASE, locale: "es-DO", timezoneId: "America/Santo_Domingo", viewport, deviceScaleFactor: 1, colorScheme: "light" });

  // ---------- Admin: people, devices, sites, policies, companies, frequent ----------
  const admin = await (await ctx()).newPage();
  let enrollCode = "";
  await step("admin-login", async () => {
    await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto("/select-panel");
    await shot(admin, "select-panel");
  });
  await step("admin-people", async () => {
    await admin.goto("/admin/people");
    await admin.getByText("Agregar persona", { exact: true }).first().click();
    await admin.locator("#name").fill("Ramón Castillo");
    await admin.locator("#email").fill("demo-ramon@airlink.test");
    await admin.locator("#department").fill("Seguridad");
    await admin.locator("#siteId").selectOption({ label: "Airlink 2" });
    await admin.getByLabel("Seguridad", { exact: true }).check();
    await admin.locator("#pin").fill("7391");
    await admin.locator("#pin").blur();
    await shot(admin, "admin-people-add", { fullPage: true });
    const existing = await db.user.findUnique({ where: { email: "demo-ramon@airlink.test" } });
    if (!existing) await admin.getByRole("button", { name: "Agregar persona" }).click();
    await admin.goto("/admin/people");
    await shot(admin, "admin-people");
  });
  await step("admin-devices", async () => {
    await admin.goto("/admin/devices");
    await admin.getByLabel("Nombre del dispositivo").fill("Tablet Recepción A2");
    await admin.getByLabel("Sitio").selectOption({ label: "Airlink 2" });
    await admin.getByLabel("Puerta").selectOption({ label: "Airlink 2 · Recepción" });
    await shot(admin, "admin-devices-create");
    await admin.getByRole("button", { name: "Crear dispositivo" }).click();
    enrollCode = (await admin.getByTestId("enroll-code").textContent())!.trim();
    await shot(admin, "admin-devices-code");
  });
  await step("admin-site", async () => {
    await admin.goto(`/admin/sites/${demo.site.id}`);
    await shot(admin, "admin-site", { fullPage: true });
  });
  await step("admin-policies", async () => {
    await admin.goto(`/admin/policies?site=${demo.site.id}`);
    await shot(admin, "admin-policies");
  });
  await step("admin-companies", async () => {
    await admin.goto("/admin/companies");
    await shot(admin, "admin-companies");
  });
  await step("admin-frequent", async () => {
    const exists = await db.frequentVisitor.findFirst({ where: { name: "Pedro Núñez" } });
    if (!exists) {
      await admin.goto(`/admin/frequent/new?siteId=${demo.site.id}`);
      await admin.locator("#name").fill("Pedro Núñez");
      await admin.locator("#company").fill("Servicios Eléctricos del Este");
      await admin.locator("#doc").fill("001-7654321-0");
      await admin.locator("#phone").fill("809-555-0142");
      await admin.locator("#hostEmployeeId").selectOption({ label: HOST.name }).catch(() => undefined);
      const nda = admin.getByTestId("frequent-nda");
      if (await nda.count()) await nda.check().catch(() => undefined);
      await admin.getByRole("button", { name: /Guardar|Crear/ }).first().click();
      await admin.waitForLoadState("networkidle");
    }
    await admin.goto("/admin/frequent");
    await shot(admin, "admin-frequent");
  });

  // ---------- Host: passes, visitor link, evacuation, account ----------
  const host = await (await ctx()).newPage();
  let token1 = "";
  let token2 = "";
  let pass1Id = "";
  await step("host-passes", async () => {
    await login(host, HOST.email, HOST.password);
    await host.goto(`/app/passes/new?siteId=${demo.site.id}`);
    await host.getByLabel("Tipo de visita").selectOption("visit");
    await host.getByLabel("Nombre del visitante").fill("Ana Rodríguez");
    await host.getByLabel("Empresa", { exact: true }).fill("Tecnología Móvil SRL");
    await host.getByLabel("Teléfono del visitante").fill("809-555-0100");
    await host.getByLabel("Cédula o pasaporte").fill("001-1234567-8");
    await host.getByLabel("Válido desde").fill(localDate(0, "08:00"));
    await host.getByLabel("Válido hasta").fill(localDate(1, "18:00"));
    await host.getByLabel("Oficinas").check();
    await host.getByLabel("Motivo o nota").fill("Reunión de seguimiento del lote 42").catch(() => undefined);
    await shot(host, "host-pass-new", { fullPage: true });
    await host.getByRole("button", { name: "Crear pase" }).click();
    await host.waitForURL(/\/app\/passes\/[a-z0-9]+/);
    await shot(host, "host-pass-detail", { fullPage: true });
    token1 = (await host.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
    pass1Id = (await db.pass.findUniqueOrThrow({ where: { token: token1 } })).id;

    // A contractor pass needs Security approval: shows the pending state on the visitor link and in approvals.
    await host.goto(`/app/passes/new?siteId=${demo.site.id}`);
    await host.getByLabel("Tipo de visita").selectOption("contractor");
    await host.getByLabel("Nombre del visitante").fill("Luis Ortega");
    await host.getByLabel("Empresa", { exact: true }).fill("Servicios Eléctricos del Este");
    await host.getByLabel("Cédula o pasaporte").fill("402-9876543-1");
    await host.getByLabel("Válido desde").fill(localDate(1, "09:00"));
    await host.getByLabel("Válido hasta").fill(localDate(3, "17:00"));
    await host.getByLabel("Producción").check().catch(() => undefined);
    await host.getByRole("button", { name: "Crear pase" }).click();
    await host.waitForURL(/\/app\/passes\/[a-z0-9]+/);
    token2 = (await host.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;

    await host.goto("/app");
    await shot(host, "host-home");
  });
  await step("warden-evacuation", async () => {
    await host.goto("/app/evacuacion");
    await shot(host, "warden-evacuation");
  });
  await step("account", async () => {
    await host.goto("/account");
    await shot(host, "account", { fullPage: true });
    await host.goto("/account/notifications");
    await shot(host, "account-notifications", { fullPage: true });
  });

  // ---------- Visitor link ----------
  await step("visitor", async () => {
    const v = await (await ctx({ width: 480, height: 900 })).newPage();
    await v.goto(`/v/${token1}`);
    await v.getByTestId("pass-qr").waitFor();
    await shot(v, "visitor-link", { fullPage: true });
    await v.goto(`/v/${token2}`);
    await shot(v, "visitor-pending", { fullPage: true });
  });

  // ---------- Approvals (the security user approves contractors) ----------
  await step("host-approvals", async () => {
    const sec = await (await ctx()).newPage();
    await login(sec, GUARD.email, GUARD.password);
    await sec.goto("/app/approvals");
    await shot(sec, "host-approvals");
  });

  // ---------- Kiosk ----------
  const k = await (await ctx(KIOSK)).newPage();
  await step("kiosk-enroll", async () => {
    await k.goto("/guard");
    await k.getByLabel("Código").fill(enrollCode);
    await shot(k, "kiosk-enroll");
    await k.getByRole("button", { name: "Enrolar" }).click();
    await k.getByRole("heading", { name: "Entrar con PIN" }).waitFor();
    await k.locator("#userId").selectOption({ label: GUARD.name });
    await k.getByLabel("PIN").fill(GUARD.pin);
    await shot(k, "kiosk-pin");
    await k.getByRole("button", { name: "Entrar" }).click();
    await k.getByRole("heading", { name: "Modo kiosco" }).waitFor();
    await shot(k, "kiosk-home");
  });
  await step("kiosk-scan", async () => {
    await k.goto("/guard/scan");
    await k.getByRole("heading", { name: "Escanear QR" }).waitFor();
    await shot(k, "kiosk-scan");
    const qr = await k.request.get(`${BASE}/api/v/${token1}/qr?format=text`);
    await k.getByTestId("manual-payload").fill(await qr.text());
    await k.getByRole("button", { name: "Validar" }).click();
    await k.getByTestId("scan-result").waitFor();
    await k.waitForTimeout(800);
    await shot(k, "kiosk-scan-result", { fullPage: true });
    const visit = await db.visit.findFirst({ where: { passId: pass1Id }, orderBy: { createdAt: "desc" } });
    if (visit) {
      await k.goto(`/guard/badge/${visit.id}`);
      await shot(k, "kiosk-badge", { fullPage: true });
    }
  });
  await step("kiosk-scan-pin", async () => {
    await k.goto("/guard/scan");
    const pin = k.getByTestId("pin-entry-pin");
    await pin.scrollIntoViewIfNeeded();
    await pin.fill("482917");
    await shot(k, "kiosk-scan-pin");
  });
  await step("kiosk-unannounced", async () => {
    await k.goto("/guard/unannounced");
    await k.locator("#hostSearch").fill("Laura");
    await k.getByTestId("host-results").getByRole("button").first().click();
    await k.locator("#visitorName").fill("Miguel Santos");
    await k.locator("#company").fill("Transporte Caribe").catch(() => undefined);
    await k.locator("#doc").fill("001-5555555-5").catch(() => undefined);
    await shot(k, "kiosk-unannounced", { fullPage: true });
  });
  await step("kiosk-inside", async () => {
    await k.goto("/guard/inside");
    await shot(k, "kiosk-inside");
  });
  await step("kiosk-evacuation", async () => {
    await k.goto("/guard/evacuation");
    await shot(k, "kiosk-evacuation");
  });
  await step("kiosk-log", async () => {
    await k.goto("/guard/log");
    await k.locator("#kind").selectOption("round");
    await k.locator("#text").fill("Ronda de las 10:00 sin novedad. Portón del muelle cerrado.");
    await k.getByRole("button", { name: "Guardar entrada" }).click();
    await k.waitForLoadState("networkidle");
    await shot(k, "kiosk-log");
  });

  // ---------- Admin: forms + reports (after there is activity) ----------
  await step("admin-forms", async () => {
    const templateName = "Proveedores nivel 1";
    const existing = await db.formTemplate.findFirst({ where: { name: templateName } });
    if (!existing) {
      await admin.goto("/admin/forms");
      await admin.getByLabel("Nombre del formulario").fill(templateName);
      await admin.getByLabel("Sitio").selectOption(demo.site.id);
      await admin.getByRole("button", { name: "Crear formulario" }).click();
      await admin.waitForURL(/\/admin\/forms\/[a-z0-9]+/);
      await admin.getByTestId("add-question").click();
      await admin.getByLabel("Etiqueta", { exact: true }).fill("Equipo que trae");
      await admin.getByLabel("Tipo de respuesta").selectOption("select");
      await admin.getByLabel("Opciones").fill("Laptop\nHerramientas\nNinguno");
      await admin.getByLabel("Obligatorio", { exact: true }).check();
      await shot(admin, "admin-form-editor", { fullPage: true });
      await admin.getByRole("button", { name: "Guardar formulario" }).click();
      await admin.waitForLoadState("networkidle");
    } else {
      await admin.goto(`/admin/forms/${existing.id}`);
      await shot(admin, "admin-form-editor", { fullPage: true });
    }
    await admin.goto("/admin/forms");
    await shot(admin, "admin-forms");
    await admin.goto(`/admin/policies?site=${demo.site.id}`);
    const vendorForm = admin.getByTestId("policy-vendor");
    await vendorForm.getByLabel("Formulario de registro").selectOption({ label: templateName });
    await vendorForm.scrollIntoViewIfNeeded();
    await vendorForm.screenshot({ path: join(OUT, "admin-policies-form.png") });
    done.add("admin-policies-form");
    console.log("[help] admin-policies-form.png");
  });
  await step("admin-reports", async () => {
    await admin.goto("/admin/reports?quick=today");
    await shot(admin, "admin-reports", { fullPage: true });
    await admin.goto("/admin/reports/audit");
    await shot(admin, "admin-report-audit", { fullPage: true });
    await admin.goto("/admin/reports/sign-in");
    const siteLink = admin.getByRole("link", { name: "Airlink 2" });
    if (await siteLink.count()) await siteLink.first().click();
    await shot(admin, "admin-sign-in", { fullPage: true });
  });

  await browser.close();
  const missing = helpShots().map((s) => s.shot).filter((s) => !done.has(s));
  console.log(`[help] ${done.size} screenshots written to ${OUT}`);
  if (missing.length) console.error(`[help] missing: ${missing.join(", ")}`);
  if (failed.length) console.error(`[help] failed steps: ${failed.join(", ")}`);
  await db.$disconnect();
  process.exit(missing.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
