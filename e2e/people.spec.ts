import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type Download, type Page } from "@playwright/test";
import { hashPassword } from "../src/lib/auth/password";
import { db } from "./db";
import { ADMIN_EMAIL, loginAsAdmin } from "./helpers";

test.setTimeout(240_000);
test.afterAll(async () => db.$disconnect());

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|admin|guard|select-panel)/);
}

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, `days` from now. */
function localDate(days: number, time: string): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

async function csvLines(download: Download): Promise<string[]> {
  const text = readFileSync((await download.path())!, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return text.slice(1).split("\r\n").filter((l) => l !== "");
}

type Kiosk = { enrollCode: string; guardName: string; deviceId: string };

/** A kiosk device + guard at Airlink 2, like e2e/kiosk.spec.ts but seeded through Prisma. */
async function seedKiosk(stamp: number, siteId: string): Promise<Kiosk> {
  const gate = await db.gate.findFirstOrThrow({ where: { siteId, name: "Recepción" }, select: { id: true } });
  const guardName = `Guardia People ${stamp}`;
  await db.user.create({ data: { email: `guard-people-${stamp}@airlink.test`, name: guardName, pinHash: await hashPassword("2468"), memberships: { create: { role: "security", siteId } } } });
  const enrollCode = `PP${stamp.toString(36).toUpperCase().slice(-6)}`;
  const device = await db.guardDevice.create({ data: { siteId, gateId: gate.id, name: `Kiosk People ${stamp}`, enrollCodeHash: sha256(enrollCode), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  return { enrollCode, guardName, deviceId: device.id };
}

async function openKiosk(browser: Browser, kiosk: Kiosk): Promise<Page> {
  const ctx = await browser.newContext({ locale: "es-DO" });
  const k = await ctx.newPage();
  await k.goto("/guard");
  await k.getByLabel("Código").fill(kiosk.enrollCode);
  await k.getByRole("button", { name: "Enrolar" }).click();
  await expect(k.getByRole("heading", { name: "Entrar con PIN" })).toBeVisible();
  await k.locator("#userId").selectOption({ label: kiosk.guardName });
  await k.getByLabel("PIN").fill("2468");
  await k.getByRole("button", { name: "Entrar" }).click();
  await expect(k.getByRole("heading", { name: "Modo kiosco" })).toBeVisible();
  return k;
}

async function enterWithPin(k: Page, pin: string) {
  await k.goto("/guard/scan");
  await expect(k.getByRole("heading", { name: "Escanear QR" })).toBeVisible();
  await k.getByTestId("pin-entry-pin").fill(pin);
  await k.getByRole("button", { name: "Entrar con PIN" }).click();
  const result = k.getByTestId("scan-result");
  await expect(result).toBeVisible();
  return result;
}

test("people screen: add a warden with PIN, inline role toggle, tabs, search and bulk deactivate", async ({ page }) => {
  const stamp = Date.now();
  const name = `Brigadista Persona ${stamp}`;
  const email = `brigadista-${stamp}@airlinkdr.com`;
  await loginAsAdmin(page);

  await page.goto("/admin/people");
  await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible();
  // Old URLs keep working.
  await page.goto("/admin/members");
  await expect(page).toHaveURL(/\/admin\/people/);
  await page.goto("/admin/employees");
  await expect(page).toHaveURL(/\/admin\/people\?tab=hosts/);

  await page.goto("/admin/people");
  await page.getByText("Agregar persona", { exact: true }).first().click();
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#department").fill("Mantenimiento");
  await page.locator("#siteId").selectOption({ label: "Airlink 2" });
  await page.getByLabel("Brigadista", { exact: true }).check();
  await page.locator("#pin").fill("2580");
  await page.getByRole("button", { name: "Agregar persona" }).click();
  await expect(page.locator("[role=status]")).toContainText("Persona agregada");

  // Search for the new person (the directory paginates at 25, so the row may not be on the first page).
  await page.goto(`/admin/people?q=${encodeURIComponent(String(stamp))}`);
  const row = page.getByTestId("person-row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-role=warden]")).toHaveAttribute("data-on", "1");
  await expect(row.locator("[data-role=host]")).toHaveAttribute("data-on", "1");
  await expect(row.locator("[data-role=admin]")).toHaveAttribute("data-on", "0");
  await expect(row.getByTestId("pin-state")).toHaveText("Tiene PIN");
  const employee = await db.employee.findUniqueOrThrow({ where: { email } });
  expect(employee.pinHash).toMatch(/^scrypt\$/);
  expect(employee.source).toBe("manual");
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
  expect(user.employeeId).toBe(employee.id);
  expect(user.memberships.map((m) => m.role)).toEqual(["warden"]);
  expect(await db.auditLog.count({ where: { action: "employee.pin_set", targetId: employee.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "member.added", targetId: user.id } })).toBe(1);

  // Inline role chip: Security on, then off (audited).
  await row.locator("button[data-role=security]").click();
  await expect(page.locator("[role=status]")).toContainText("Rol activado");
  await expect(page.getByTestId("person-row").filter({ hasText: name }).locator("[data-role=security]")).toHaveAttribute("data-on", "1");
  expect(await db.membership.count({ where: { userId: user.id, role: "security", status: "active" } })).toBe(1);
  await page.getByTestId("person-row").filter({ hasText: name }).locator("button[data-role=security]").click();
  await expect(page.locator("[role=status]")).toContainText("Rol desactivado");
  expect(await db.membership.count({ where: { userId: user.id, role: "security", status: "disabled" } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "member.disabled", targetId: user.id } })).toBe(1);

  // Reset the PIN from the row.
  await page.getByTestId("person-row").filter({ hasText: name }).getByLabel(`PIN de ${name}`).fill("1357");
  await page.getByTestId("person-row").filter({ hasText: name }).getByRole("button", { name: "Cambiar PIN" }).click();
  await expect(page.locator("[role=status]")).toContainText("PIN guardado");
  const reset = await db.employee.findUniqueOrThrow({ where: { email } });
  expect(reset.pinHash).not.toBe(employee.pinHash);

  // Tabs filter the list.
  await page.goto(`/admin/people?tab=wardens&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(1);
  await page.goto(`/admin/people?tab=pin&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(1);
  await page.goto(`/admin/people?tab=admins&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(0);
  await page.goto(`/admin/people?tab=inactive&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(0);
  await page.goto(`/admin/people?tab=hosts&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(1);
  await expect(page.getByText("1 persona", { exact: true })).toBeVisible();

  // Bulk select → deactivate (never delete).
  await page.goto(`/admin/people?q=${encodeURIComponent(String(stamp))}`);
  await page.getByLabel(`Seleccionar a ${name}`).check();
  await page.getByTestId("bulk-deactivate").click();
  await expect(page.locator("[role=status]")).toContainText("1 persona desactivada");
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveAttribute("data-active", "0");
  await page.goto(`/admin/people?tab=inactive&q=${encodeURIComponent(String(stamp))}`);
  await expect(page.getByTestId("person-row").filter({ hasText: name })).toHaveCount(1);
  const deactivated = await db.employee.findUniqueOrThrow({ where: { email } });
  expect(deactivated.active).toBe(false);
  expect((await db.user.findUniqueOrThrow({ where: { email } })).status).toBe("disabled");
});

test("warden sees the offline-capable evacuation list with roll call; admin sends it to the wardens", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const wardenEmail = `warden-${stamp}@airlink.test`;
  const wardenPassword = `Warden-${stamp}-pass!`;
  const warden = await db.user.create({ data: { email: wardenEmail, name: `Brigadista ${stamp}`, passwordHash: await hashPassword(wardenPassword), memberships: { create: { role: "warden", siteId: site.id } } } });
  const host = await db.employee.create({ data: { name: `Anfitrión Evac ${stamp}`, siteId: site.id, source: "manual" } });
  const insideName = `Visitante Dentro ${stamp}`;
  await db.visit.create({ data: { siteId: site.id, gateId: gate.id, hostEmployeeId: host.id, visitorName: insideName, kind: "visit", status: "inside", requestedById: admin.id, enteredAt: new Date() } });
  const employee = await db.employee.create({ data: { name: `Empleado Presente ${stamp}`, department: "IQC", siteId: site.id, source: "manual" } });
  await db.employeePresence.create({ data: { siteId: site.id, gateId: gate.id, employeeId: employee.id } });

  const wardenCtx = await browser.newContext({ locale: "es-DO" });
  const w = await wardenCtx.newPage();
  await login(w, wardenEmail, wardenPassword);
  await expect(w).toHaveURL(/\/app\/evacuacion/);
  await expect(w.getByRole("heading", { name: "Lista de evacuación" })).toBeVisible();
  const list = w.getByTestId("warden-evacuation");
  await expect(list).toContainText(insideName);
  await expect(list).toContainText(`Empleado Presente ${stamp}`);
  await expect(list).toContainText("Empleados registrados");
  await expect(w.getByTestId("warden-updated")).toContainText("Última actualización");
  await expect(w.locator("[data-testid^=send-evacuation-]")).toHaveCount(0); // wardens only read

  // Roll call during a drill: ticks persist locally only.
  await w.getByTestId("roll-call-toggle").click();
  const total = await w.getByTestId("evacuation-person").count();
  await expect(w.getByTestId("roll-call-counted")).toHaveText(`Contados 0 de ${total}`);
  await w.getByLabel(`Contar a ${insideName}`).check();
  await expect(w.getByTestId("roll-call-counted")).toHaveText(`Contados 1 de ${total}`);
  await w.reload();
  await expect(w.getByTestId("roll-call-counted")).toHaveText(`Contados 1 de ${total}`);
  expect(await db.visit.count({ where: { visitorName: insideName, status: "inside" } })).toBe(1); // read-only

  // Stored in IndexedDB for offline use.
  const stored = await w.evaluate(async () => {
    const open = indexedDB.open("visitas-warden");
    return new Promise<boolean>((resolve) => {
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", "readonly");
        const req = tx.objectStore("kv").get("snapshot");
        req.onsuccess = () => resolve(Boolean(req.result && (req.result as { generatedAt?: string }).generatedAt));
        req.onerror = () => resolve(false);
      };
      open.onerror = () => resolve(false);
    });
  });
  expect(stored).toBe(true);
  await wardenCtx.close();

  // Admin pushes the list to the wardens of the site.
  await loginAsAdmin(page);
  await page.goto("/app/evacuacion");
  await page.getByTestId(`send-evacuation-${site.id}`).click();
  await expect(page.locator("[role=status]").first()).toContainText("Lista enviada a");
  expect(await db.notification.count({ where: { userId: warden.id, type: "evacuation_list" } })).toBeGreaterThan(0);
  expect(await db.auditLog.count({ where: { action: "evacuation.sent", targetId: site.id, actorId: admin.id } })).toBeGreaterThan(0);
});

test("frequent visitor with PIN: admin creates it, kiosk enters and leaves with the PIN", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const host = await db.employee.create({ data: { name: `Supervisor Frecuente ${stamp}`, department: "Facilities", siteId: site.id, source: "manual" } });
  const kiosk = await seedKiosk(stamp, site.id);
  const name = `Limpieza Frecuente ${stamp}`;
  const pin = String(stamp).slice(-6); // unique per run: PIN candidates are matched first-wins

  await loginAsAdmin(page);
  await page.goto("/admin/frequent");
  await expect(page.getByRole("heading", { name: "Visitantes frecuentes" })).toBeVisible();
  await page.getByRole("link", { name: "Nuevo visitante frecuente" }).click();
  await page.getByRole("link", { name: "Airlink 2" }).click();
  await page.locator("#name").fill(name);
  await page.locator("#company").fill(`Servicios Frecuentes ${stamp}`);
  await page.locator("#doc").fill("001-7654321-9");
  await page.locator("#phone").fill("809-555-0199");
  await page.locator("#hostEmployeeId").selectOption({ value: host.id });
  await page.getByLabel("PIN", { exact: true }).check();
  await page.locator("#pin").fill(pin);
  // Whole week, whole day: the kiosk test must pass whatever time it runs.
  for (const d of ["Sáb", "Dom"]) await page.getByLabel(d, { exact: true }).check();
  await page.locator("#scheduleFrom").fill("00:00");
  await page.locator("#scheduleTo").fill("00:00");
  await page.locator("#validFrom").fill(localDate(-1, "00:00"));
  await page.getByTestId("frequent-nda").check(); // recurring policy requires the NDA: admin confirms the paper acceptance
  await page.getByRole("button", { name: "Crear visitante frecuente" }).click();
  await expect(page).toHaveURL(/\/admin\/frequent\?ok=created/);
  await expect(page.locator("[role=status]")).toContainText("Visitante frecuente creado");
  const frow = page.getByTestId("frequent-row").filter({ hasText: name });
  await expect(frow).toContainText("PIN");
  await expect(frow).toContainText("Vigente");

  const visitor = await db.frequentVisitor.findFirstOrThrow({ where: { name }, include: { pass: true } });
  expect(visitor.signIn).toBe("pin");
  expect(visitor.pinHash).toMatch(/^scrypt\$/);
  expect(visitor.docLast4).toBe("3219");
  expect(visitor.pass?.status).toBe("active");
  expect(visitor.pass?.kind).toBe("recurring");
  expect(visitor.pass?.pinHash).toMatch(/^scrypt\$/);
  expect(visitor.pass?.schedule).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00" });
  expect(await db.auditLog.count({ where: { action: "pass.created", targetId: visitor.passId!, meta: { path: ["frequent"], equals: true } } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "frequent.changed", targetId: visitor.id } })).toBe(1);
  expect(visitor.pass?.ndaAcceptedAt).toBeTruthy();
  expect(await db.auditLog.count({ where: { action: "nda.accepted", targetId: visitor.passId!, meta: { path: ["onBehalf"], equals: true } } })).toBe(1);

  // Printable card page (PIN visitors get a name-only card; the QR is for qr_card visitors).
  await page.goto(`/admin/frequent/${visitor.id}/card`);
  await expect(page.getByTestId("access-card")).toContainText(name);
  await expect(page.getByText("Este visitante entra con PIN")).toBeVisible();

  // Kiosk: PIN entry → inside; the same PIN again → exit.
  const k = await openKiosk(browser, kiosk);
  let result = await enterWithPin(k, pin);
  await expect(result).toHaveAttribute("data-tone", "ok");
  await expect(result).toContainText("Entrada registrada");
  await expect(result).toContainText(name);
  const visit = await db.visit.findFirstOrThrow({ where: { passId: visitor.passId! } });
  expect(visit.status).toBe("inside");
  expect(await db.auditLog.count({ where: { action: "visit.entered", targetId: visit.id, meta: { path: ["via"], equals: "pin" } } })).toBe(1);

  await k.getByRole("button", { name: "Escanear otro" }).click();
  result = await enterWithPin(k, pin);
  await expect(result).toHaveAttribute("data-tone", "left");
  expect((await db.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe("left");

  // A wrong PIN is refused.
  await k.getByRole("button", { name: "Escanear otro" }).click();
  result = await enterWithPin(k, "000000");
  await expect(result).toHaveAttribute("data-tone", "deny");
  await expect(result).toHaveAttribute("data-reason", "not_found");
  await k.context().close();
});

test("host pass with generated PIN: shown once, e-mailed, kiosk entry, invites report and CSV", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const kiosk = await seedKiosk(stamp, site.id);
  const hostEmail = `host-pin-${stamp}@airlink.test`;
  const hostPassword = `Host-${stamp}-pin!`;
  await db.user.create({ data: { email: hostEmail, name: `Host PIN ${stamp}`, passwordHash: await hashPassword(hostPassword), memberships: { create: { role: "host", siteId: null } } } });
  const visitorName = `Visitante PIN ${stamp}`;
  const visitorEmail = `visitante-${stamp}@example.com`;

  const hostCtx = await browser.newContext({ locale: "es-DO" });
  const h = await hostCtx.newPage();
  await login(h, hostEmail, hostPassword);
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("visit");
  await h.getByLabel("Nombre del visitante").fill(visitorName);
  await h.getByLabel("Cédula o pasaporte").fill("001-1122334-5");
  await h.getByLabel("Válido desde").fill(localDate(-1, "00:00"));
  await h.getByLabel("Válido hasta").fill(localDate(1, "23:00"));
  await h.getByTestId("generate-pin").check();
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  const pin = (await h.getByTestId("pass-pin-value").textContent())!.trim();
  expect(pin).toMatch(/^\d{6}$/);
  const token = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
  const pass = await db.pass.findUniqueOrThrow({ where: { token } });
  expect(pass.pinHash).toMatch(/^scrypt\$/);
  expect(await db.auditLog.count({ where: { action: "pass.created", targetId: pass.id, meta: { path: ["pin"], equals: true } } })).toBe(1);

  // Invitation e-mail (NOTIFY_FAKE on the server records it; audited either way when sent).
  await h.locator("#inviteEmail").fill(visitorEmail);
  await h.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(h.locator("p[role=status]")).toContainText("Invitación enviada");
  expect(await db.auditLog.count({ where: { action: "pass.emailed", targetId: pass.id } })).toBe(1);
  expect((await db.pass.findUniqueOrThrow({ where: { id: pass.id } })).visitorEmail).toBe(visitorEmail);

  // The public link mentions the PIN without revealing it.
  const v = await browser.newContext({ locale: "es-DO" });
  const vp = await v.newPage();
  await vp.goto(`/v/${token}`);
  await expect(vp.getByTestId("pass-pin-note")).toBeVisible();
  await expect(vp.getByText(pin)).toHaveCount(0);
  await v.close();
  await hostCtx.close();

  // Kiosk entry with the PIN (narrowed by name).
  const k = await openKiosk(browser, kiosk);
  await k.goto("/guard/scan");
  await k.getByTestId("pin-entry-pin").fill(pin);
  await k.locator("#pin-entry-name").fill(`PIN ${stamp}`);
  await k.getByRole("button", { name: "Entrar con PIN" }).click();
  const result = k.getByTestId("scan-result");
  await expect(result).toHaveAttribute("data-tone", "ok");
  await expect(result).toContainText(visitorName);
  const visit = await db.visit.findFirstOrThrow({ where: { passId: pass.id } });
  expect(visit.status).toBe("inside");
  await k.context().close();

  // Invites report lists it with PIN = Sí and signed in = Sí; CSV export carries the same row.
  await loginAsAdmin(page);
  const q = encodeURIComponent(visitorName);
  await page.goto(`/admin/reports/invites?q=${q}`);
  await expect(page.getByTestId("invite-total")).toHaveText("1");
  await expect(page.getByTestId("invite-signed-in")).toHaveText("1");
  const irow = page.getByTestId("invite-row").filter({ hasText: visitorName });
  await expect(irow).toContainText("Sí · ");
  await expect(irow).toContainText("Usado");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const lines = await csvLines(download);
  expect(lines[0]).toBe("Fecha;Visitante;Correo;Empresa;Anfitrión;Tipo;Sitio;PIN;Llegó;Entrada;Estado;Vence;Creado por;Frecuente");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(`;${visitorName};${visitorEmail};;Host PIN ${stamp};Visita;Airlink 2;Sí;Sí;`);
  await page.goto(`/admin/reports/invites?q=${q}&pin=no`);
  await expect(page.getByTestId("invite-total")).toHaveText("0");
});
