import { expect, test } from "@playwright/test";
import { db } from "./db";
import { loginAsAdmin } from "./helpers";
import { hashPassword } from "../src/lib/auth/password";
import { localParts } from "../src/lib/time/tz";

test.setTimeout(180_000);

const created = { employeeIds: [] as string[], visitIds: [] as string[], gateId: "" };

test.afterAll(async () => {
  await db.visit.deleteMany({ where: { id: { in: created.visitIds } } }).catch(() => undefined);
  await db.employeePresence.deleteMany({ where: { employeeId: { in: created.employeeIds } } }).catch(() => undefined);
  await db.employee.deleteMany({ where: { id: { in: created.employeeIds } } }).catch(() => undefined);
  if (created.gateId) await db.gate.update({ where: { id: created.gateId }, data: { selfSignInToken: null } }).catch(() => undefined);
  await db.$disconnect();
});

test("gate QR self sign-in, employee PIN presence, manual sign-in, report filters and auto sign-out", async ({ browser, page, request }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });
  created.gateId = gate.id;
  // Company-wide employees (siteId null) are visible from every site, whatever site the admin's panel has selected.
  const host = await db.employee.create({ data: { name: `Anfitrión Ops ${stamp}`, email: `host-ops-${stamp}@airlink.test`, siteId: null, source: "manual" } });
  const employee = await db.employee.create({ data: { name: `Empleado Ops ${stamp}`, email: `emp-ops-${stamp}@airlink.test`, siteId: null, department: "IQC", source: "manual", pinHash: await hashPassword("2468") } });
  created.employeeIds.push(host.id, employee.id);

  // 1. Admin enables self sign-in on the gate and sees the poster.
  await loginAsAdmin(page);
  await page.goto(`/admin/sites/${site.id}`);
  const row = page.locator('[data-testid="gate"][data-gate-name="Recepción"]');
  await expect(row).toBeVisible();
  if (!(await row.getByTestId("poster-link").isVisible())) {
    await row.getByTestId("toggle-self-sign-in").click();
    await expect(page.locator(".alert-ok")).toContainText("Auto-registro activado");
  }
  await expect(row.getByTestId("poster-link")).toBeVisible();
  const token = (await db.gate.findUniqueOrThrow({ where: { id: gate.id } })).selfSignInToken;
  expect(token).toBeTruthy();
  await expect(row.getByTestId("self-sign-in-url")).toContainText(`/s/${token}`);
  await page.goto(`/admin/sites/${site.id}/gates/${gate.id}/poster`);
  await expect(page.getByTestId("gate-poster")).toContainText("Regístrate aquí");
  await expect(page.getByTestId("gate-poster").locator("img")).toBeVisible();

  // 2. Anonymous visitor registers a walk-in from the poster link.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const visitorName = `Walk-in ${stamp}`;
  await visitor.goto(`/s/${token}`);
  await expect(visitor.getByRole("heading", { name: "Regístrate en recepción" })).toBeVisible();
  await visitor.getByLabel("Tu nombre").fill(visitorName);
  await visitor.getByLabel("Empresa").fill(`Empresa Ops ${stamp}`);
  await visitor.getByLabel("Motivo de la visita").selectOption("vendor");
  await visitor.getByLabel("¿A quién visitas?").fill(`Anfitrión Ops ${stamp}`);
  await visitor.getByTestId("hostEmployeeId-results").getByRole("button", { name: host.name }).click();
  await expect(visitor.getByTestId("hostEmployeeId-selected")).toContainText(host.name);
  await visitor.getByLabel("Cédula o pasaporte").fill("001-1234567-8");
  await visitor.getByLabel("Teléfono").fill("809-555-0100");
  await visitor.getByRole("button", { name: "Avisar a mi anfitrión" }).click();
  await visitor.waitForURL(new RegExp(`/s/${token}/v/[A-Za-z0-9_-]+\\?k=`));
  await expect(visitor.getByTestId("self-visitor")).toHaveText(visitorName);
  await expect(visitor.getByTestId("self-status")).toHaveAttribute("data-status", "pending");
  await expect(visitor.getByTestId("self-status")).toContainText("Avisamos a tu anfitrión");
  const walkIn = await db.visit.findFirstOrThrow({ where: { visitorName }, include: { requestedBy: true, host: true } });
  created.visitIds.push(walkIn.id);
  expect(walkIn.status).toBe("pending");
  expect(walkIn.docLast4).toBe("5678");
  expect(walkIn.requestedBy.email).toBe("system@airlinkdr.com");
  expect(walkIn.host?.id).toBe(host.id);
  expect((walkIn.extra as { phone?: string }).phone).toBe("809-555-0100");
  // The status key is required: without it the page is not found.
  expect((await request.get(`/api/s/visits/${walkIn.id}`)).status()).toBe(404);

  // The host (or security) approves — same transition decideVisit makes — and the visitor's page follows within 4 s.
  await db.visit.update({ where: { id: walkIn.id }, data: { status: "approved", decidedAt: new Date() } });
  await expect(visitor.getByTestId("self-status")).toHaveAttribute("data-status", "approved", { timeout: 15_000 });
  await expect(visitor.getByTestId("self-status")).toContainText("Visita aprobada");

  // 3. Employee checks in with the PIN set by IT (slice I); shows up on the admin evacuation list.
  await visitor.goto(`/s/${token}?mode=employee`);
  await visitor.getByLabel("Tu nombre").fill(`Empleado Ops ${stamp}`);
  await visitor.getByTestId("employeeId-results").getByRole("button", { name: employee.name }).click();
  await visitor.getByLabel("PIN").fill("0000");
  await visitor.getByRole("button", { name: "Marcar entrada / salida" }).click();
  await expect(visitor.getByTestId("self-error")).toContainText("PIN incorrecto");
  await visitor.getByLabel("Tu nombre").fill(`Empleado Ops ${stamp}`);
  await visitor.getByTestId("employeeId-results").getByRole("button", { name: employee.name }).click();
  await visitor.getByLabel("PIN").fill("2468");
  await visitor.getByRole("button", { name: "Marcar entrada / salida" }).click();
  await expect(visitor.getByTestId("self-ok")).toContainText("Entrada registrada");
  const presence = await db.employeePresence.findFirstOrThrow({ where: { employeeId: employee.id, leftAt: null } });
  expect(presence.gateId).toBe(gate.id);
  await visitorContext.close();

  await page.goto("/admin");
  await page.getByTestId("evacuation-link").click();
  await expect(page).toHaveURL(/\/admin\/evacuation/);
  const siteCard = page.locator('[data-testid="evacuation-site"][data-site="Airlink 2"]');
  await expect(siteCard.getByTestId("evacuation-employee").filter({ hasText: employee.name })).toBeVisible();
  await expect(siteCard.getByTestId("evacuation-site-total")).toContainText("empleado");

  // 4. Manual sign-in from the admin panel creates a visit that is inside at once.
  const manualName = `Manual ${stamp}`;
  await page.goto(`/admin/reports/sign-in?siteId=${site.id}`);
  await expect(page.getByRole("heading", { name: "Registrar visita" })).toBeVisible();
  await page.getByLabel("Tipo de visita").selectOption("vendor");
  await page.getByLabel("Anfitrión").fill(`Anfitrión Ops ${stamp}`);
  await page.getByTestId("hostEmployeeId-results").getByRole("button", { name: host.name }).click();
  await page.getByLabel("Nombre del visitante").fill(manualName);
  await page.getByLabel("Empresa").fill(`Empresa Ops ${stamp}`);
  await page.getByLabel("Placa").fill("A123456");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByTestId("sign-in-ok")).toContainText(`${manualName} registrado y dentro.`);
  const manual = await db.visit.findFirstOrThrow({ where: { visitorName: manualName } });
  created.visitIds.push(manual.id);
  expect(manual.status).toBe("inside");
  expect(manual.enteredAt).not.toBeNull();
  const approvedAudit = await db.auditLog.findFirst({ where: { action: "visit.approved", targetId: manual.id } });
  expect((approvedAudit?.meta as { via?: string })?.via).toBe("admin");

  // 5. Reports: quick filter "Hoy" + free-text search find it; KPI tiles count it.
  await page.goto(`/admin/reports?siteId=${manual.siteId}`);
  await page.getByTestId("quick-today").click();
  await expect(page).toHaveURL(/range=today/);
  await page.getByLabel("Buscar").fill(`Manual ${stamp}`);
  await page.getByLabel("Filas por página").selectOption("25");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/pageSize=25/);
  await expect(page.getByTestId("visit-total")).toHaveText("1");
  await expect(page.getByTestId("visits-table")).toContainText(manualName);
  expect(Number(await page.getByTestId("kpi-inside").textContent())).toBeGreaterThanOrEqual(1);
  expect(Number(await page.getByTestId("kpi-entered").textContent())).toBeGreaterThanOrEqual(1);
  // Plate and docLast4 are searchable too.
  await page.goto(`/admin/reports?siteId=${manual.siteId}&range=today&q=A123456`);
  await expect(page.getByTestId("visits-table")).toContainText(manualName);

  // 6. Auto sign-out: the vendor policy closes open visits at a time that has already passed today.
  const policyBefore = await db.visitPolicy.findUniqueOrThrow({ where: { siteId_kind: { siteId: manual.siteId, kind: "vendor" } } });
  const visitSite = await db.site.findUniqueOrThrow({ where: { id: manual.siteId } });
  const now = new Date();
  const cutoffLocal = localParts(new Date(now.getTime() - 5 * 60_000), visitSite.timezone).minutes;
  const autoSignOutAt = `${String(Math.floor(cutoffLocal / 60)).padStart(2, "0")}:${String(cutoffLocal % 60).padStart(2, "0")}`;
  // Entered yesterday, so the cutoff (5 minutes ago, local) lies between the entry and now.
  await db.visit.update({ where: { id: manual.id }, data: { enteredAt: new Date(now.getTime() - 25 * 3_600_000) } });
  await db.visitPolicy.update({ where: { id: policyBefore.id }, data: { autoSignOutAt } });
  try {
    const tick = await request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "dev-cron-secret"}` } });
    expect(tick.ok()).toBeTruthy();
    expect((await tick.json()).result.autoClosed).toBeGreaterThanOrEqual(1);
  } finally {
    await db.visitPolicy.update({ where: { id: policyBefore.id }, data: { autoSignOutAt: policyBefore.autoSignOutAt } });
  }
  const closed = await db.visit.findUniqueOrThrow({ where: { id: manual.id } });
  expect(closed.status).toBe("left");
  expect(closed.autoClosed).toBe(true);
  expect(closed.leftAt).not.toBeNull();
  expect(closed.leftAt!.getTime()).toBeLessThanOrEqual(now.getTime());
  const leftAudit = await db.auditLog.findFirst({ where: { action: "visit.left", targetId: manual.id } });
  expect((leftAudit?.meta as { auto?: boolean })?.auto).toBe(true);
  // A second tick does not touch it again.
  const again = await request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "dev-cron-secret"}` } });
  expect((await again.json()).result.autoClosed).toBe(0);
});
