import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../src/lib/auth/password";
import { verifyQr } from "../src/lib/passes/validate";
import { createLocalHost, db } from "./db";

test.afterAll(async () => db.$disconnect());
test.setTimeout(180_000);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|guard|select-panel)/);
}

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, `days` from now (date only; the time is given). */
function localDate(days: number, time: string): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

async function fillBasics(page: Page, kind: string, name: string, doc: string) {
  await page.getByLabel("Tipo de visita").selectOption(kind);
  await page.getByLabel("Nombre del visitante").fill(name);
  await page.getByLabel("Cédula o pasaporte").fill(doc);
  await page.getByLabel("Válido desde").fill(localDate(1, "09:00"));
  await page.getByLabel("Válido hasta").fill(localDate(2, "18:00"));
}

async function visitorToken(page: Page): Promise<string> {
  const link = await page.getByTestId("visitor-link").inputValue();
  const token = link.split("/v/")[1];
  expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  return token!;
}

test("host creates passes, security approves, visitor link shows QR, status and NDA; recurring QR rotates", async ({ browser, request }) => {
  const stamp = Date.now();
  const host = await createLocalHost(stamp);
  const secEmail = `security-${stamp}@airlink.test`;
  const secPassword = `Sec-${stamp}-pass!`;
  await db.user.create({
    data: { email: secEmail, name: `Seguridad ${stamp}`, passwordHash: await hashPassword(secPassword), memberships: { create: { role: "security", siteId: null } } },
  });
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });

  const hostCtx = await browser.newContext({ locale: "es-DO" });
  const page = await hostCtx.newPage();
  await login(page, host.email, host.password);
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { name: "Mis visitas" })).toBeVisible();

  // 1. Visit pass (no approval needed): the membership covers every site, so the form asks which one.
  await page.goto("/app/passes/new");
  await page.getByRole("link", { name: "Airlink 2" }).click();
  await expect(page).toHaveURL(new RegExp(`siteId=${site.id}`));
  await fillBasics(page, "visit", `Visita ${stamp}`, "001-1234567-8");
  await page.getByLabel("Empresa", { exact: true }).fill(`Empresa ${stamp}`);
  await page.getByLabel("Teléfono del visitante").fill("809-555-0100");
  await page.getByLabel("Oficinas").check();
  await page.getByRole("button", { name: "Crear pase" }).click();
  await expect(page).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  await expect(page.locator("[role=status]")).toContainText("Pase creado");
  await expect(page.locator("[data-status=active]")).toBeVisible();
  await expect(page.getByText("termina en 5678")).toBeVisible();
  const token1 = await visitorToken(page);
  const pass1 = await db.pass.findUniqueOrThrow({ where: { token: token1 } });
  expect(pass1.visitorDocHash).toBeTruthy();
  expect(pass1.visitorDocLast4).toBe("5678");
  expect(pass1.siteId).toBe(site.id);

  const visitorCtx = await browser.newContext({ locale: "es-DO" });
  const v = await visitorCtx.newPage();
  await v.goto(`/v/${token1}`);
  await expect(v.getByTestId("pass-status")).toHaveAttribute("data-status", "active");
  await expect(v.getByTestId("pass-qr")).toBeVisible();
  await expect(v.getByText(`Visita ${stamp}`)).toBeVisible();
  await expect(v.getByText(host.email)).toHaveCount(0); // never the host's contact details
  const qr1 = await request.get(`/api/v/${token1}/qr?format=text`);
  expect(qr1.ok()).toBeTruthy();
  const check1 = verifyQr(await qr1.text(), { siteId: site.id, key: process.env.PASS_SIGNING_KEY! });
  expect(check1).toMatchObject({ ok: true, qr: { kind: "static", passId: pass1.id } });

  await page.goto("/app");
  await expect(page.getByRole("link", { name: `Visita ${stamp}` })).toBeVisible();

  // 2. Contractor pass: needs Security approval and NDA.
  await page.goto(`/app/passes/new?siteId=${site.id}`);
  await fillBasics(page, "contractor", `Contratista ${stamp}`, "402-9876543-1");
  await page.getByRole("button", { name: "Crear pase" }).click();
  await expect(page).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  await expect(page.locator("[data-status=pending_approval]")).toBeVisible();
  const detail2 = page.url().split("?")[0]!;
  const token2 = await visitorToken(page);

  await v.goto(`/v/${token2}`);
  await expect(v.getByTestId("pass-status")).toHaveAttribute("data-status", "pending_approval");
  await expect(v.getByTestId("pass-qr")).toHaveCount(0);
  expect((await request.get(`/api/v/${token2}/qr`)).status()).toBe(409);
  // Pre-registration (phone was not given) and NDA acceptance from the public link.
  await v.getByLabel("Teléfono").fill("829-555-0101");
  await v.getByLabel("Placa del vehículo", { exact: false }).fill("A123456");
  await v.getByRole("button", { name: "Guardar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Datos guardados");
  await expect(v.getByRole("heading", { name: "Política de visitantes", exact: true })).toBeVisible();
  await v.getByLabel("He leído y acepto la política de visitantes").check();
  await v.getByLabel("Escribe tu nombre completo como firma").fill(`Contratista ${stamp}`);
  await v.getByRole("button", { name: "Aceptar" }).click();
  await expect(v.locator("[role=status]")).toContainText("Política aceptada");
  const pass2 = await db.pass.findUniqueOrThrow({ where: { token: token2 } });
  expect(pass2.ndaAcceptedAt).toBeTruthy();
  expect(pass2.ndaVersion).toBe("1.0");
  expect(pass2.visitorPhone).toBe("829-555-0101");
  expect(pass2.plate).toBe("A123456");

  const secCtx = await browser.newContext({ locale: "es-DO" });
  const s = await secCtx.newPage();
  await login(s, secEmail, secPassword);
  await s.goto("/app/approvals");
  await expect(s.getByRole("heading", { name: "Aprobaciones pendientes" })).toBeVisible();
  const card = s.getByTestId("pending-pass").filter({ hasText: `Contratista ${stamp}` });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Aprobar" }).click();
  await expect(s.locator("[role=status]")).toContainText("Pase aprobado");
  await expect(s.getByTestId("pending-pass").filter({ hasText: `Contratista ${stamp}` })).toHaveCount(0);

  await v.goto(`/v/${token2}`);
  await expect(v.getByTestId("pass-status")).toHaveAttribute("data-status", "active");
  await expect(v.getByTestId("pass-qr")).toBeVisible();
  const approved = await db.pass.findUniqueOrThrow({ where: { token: token2 } });
  expect(approved.approvedById).toBeTruthy();
  expect(await db.notification.count({ where: { type: "pass_approved", payload: { path: ["passId"], equals: approved.id } } })).toBeGreaterThan(0);
  expect(await db.notification.count({ where: { type: "pass_pending_approval", payload: { path: ["passId"], equals: approved.id } } })).toBeGreaterThan(0);

  // 3. Revoke → visitor sees it cancelled.
  await page.goto(detail2);
  await page.getByRole("button", { name: "Cancelar pase" }).click();
  await expect(page.locator("[role=status]")).toContainText("Pase cancelado");
  await expect(page.locator("[data-status=revoked]")).toBeVisible();
  await v.goto(`/v/${token2}`);
  await expect(v.getByTestId("pass-status")).toHaveAttribute("data-status", "revoked");
  await expect(v.getByTestId("pass-status")).toContainText("Cancelado");
  expect((await request.get(`/api/v/${token2}/qr?format=text`)).status()).toBe(409);
  expect(await db.auditLog.count({ where: { targetId: approved.id, action: { in: ["pass.created", "pass.approved", "pass.revoked", "nda.accepted"] } } })).toBe(4);

  // 4. Recurring pass: schedule, Security approval, rotating QR accepted by verifyQr.
  await page.goto(`/app/passes/new?siteId=${site.id}`);
  await fillBasics(page, "recurring", `Limpieza ${stamp}`, "223-4567890-1");
  await page.getByLabel("Válido desde").fill(localDate(-1, "00:00"));
  await page.getByLabel("Válido hasta").fill(localDate(30, "23:00"));
  for (const d of ["Lun", "Mar", "Mié", "Jue", "Vie"]) await page.getByLabel(d, { exact: true }).check();
  await page.getByLabel("Hora de entrada").fill("07:00");
  await page.getByLabel("Hora de salida").fill("19:00");
  await page.getByRole("button", { name: "Crear pase" }).click();
  await expect(page).toHaveURL(/\/app\/passes\/[a-z0-9]+\?ok=created$/);
  await expect(page.locator("[data-status=pending_approval]")).toBeVisible();
  await expect(page.getByText("Lun Mar Mié Jue Vie · 07:00–19:00")).toBeVisible();
  const token3 = await visitorToken(page);
  const pass3 = await db.pass.findUniqueOrThrow({ where: { token: token3 } });
  expect(pass3.schedule).toEqual({ days: [1, 2, 3, 4, 5], from: "07:00", to: "19:00" });

  await s.goto("/app/approvals");
  await s.getByTestId("pending-pass").filter({ hasText: `Limpieza ${stamp}` }).getByRole("button", { name: "Aprobar" }).click();
  await expect(s.locator("[role=status]")).toContainText("Pase aprobado");

  const qr3 = await request.get(`/api/v/${token3}/qr?format=text`);
  expect(qr3.ok()).toBeTruthy();
  const payload3 = await qr3.text();
  expect(verifyQr(payload3, { siteId: site.id, key: process.env.PASS_SIGNING_KEY! })).toMatchObject({ ok: true, qr: { kind: "rotating", passId: pass3.id } });
  expect(verifyQr(payload3, { siteId: "other-site", key: process.env.PASS_SIGNING_KEY! })).toMatchObject({ ok: false });
  const json3 = await (await request.get(`/api/v/${token3}/qr`)).json();
  expect(json3).toMatchObject({ rotating: true, payload: expect.stringMatching(/\.r[a-z0-9]+\./) });
  expect(json3.dataUrl).toMatch(/^data:image\/png;base64,/);
  await v.goto(`/v/${token3}`);
  await expect(v.getByTestId("pass-qr")).toHaveAttribute("data-rotating", "true");

  // 5. Group pass: N passes share a groupId; members can be renamed.
  await page.goto(`/app/passes/new?siteId=${site.id}`);
  await fillBasics(page, "vendor", `Proveedor ${stamp}`, "001-0000000-1");
  await page.getByLabel("Tamaño del grupo").fill("3");
  await page.getByRole("button", { name: "Crear pase" }).click();
  await expect(page).toHaveURL(/\?ok=createdGroup$/);
  await expect(page.locator("[role=status]")).toContainText("3 pases");
  await expect(page.getByRole("link", { name: "Visitante 2" })).toBeVisible();
  await page.getByRole("link", { name: "Visitante 3" }).click();
  await page.getByLabel("Nombre del visitante").fill(`Tercero ${stamp}`);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("[role=status]")).toContainText("Nombre actualizado");
  const lead = await db.pass.findFirst({ where: { visitorName: `Proveedor ${stamp}` } });
  expect(lead?.groupId).toBeTruthy();
  expect(await db.pass.count({ where: { groupId: lead!.groupId! } })).toBe(3);

  // 6. Another host cannot open this host's pass.
  const other = await createLocalHost(`${stamp}b`);
  const otherCtx = await browser.newContext({ locale: "es-DO" });
  const o = await otherCtx.newPage();
  await login(o, other.email, other.password);
  const res = await o.goto(detail2);
  expect(res?.status()).toBe(404);

  await Promise.all([hostCtx.close(), visitorCtx.close(), secCtx.close(), otherCtx.close()]);
});
