import { expect, test, type Page } from "@playwright/test";
import { ADMIN_EMAIL } from "./helpers";
import { createLocalHost, db } from "./db";

test.setTimeout(120_000);

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(app|select-panel)/);
}

const created = { userIds: [] as string[], employeeIds: [] as string[], visitIds: [] as string[] };

test.afterAll(async () => {
  await db.visit.deleteMany({ where: { id: { in: created.visitIds } } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: { in: created.userIds } } }).catch(() => undefined);
  await db.employee.deleteMany({ where: { id: { in: created.employeeIds } } }).catch(() => undefined);
  await db.$disconnect();
});

test("host sees a pending unannounced visit in /app/notifications and approves it", async ({ page }) => {
  const stamp = Date.now();
  const { email, password } = await createLocalHost(`n${stamp}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  created.userIds.push(user.id);
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, kind: "pedestrian" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const employee = await db.employee.create({ data: { name: `Anfitrión ${stamp}`, email: `emp-${stamp}@airlink.test`, siteId: site.id, source: "manual" } });
  created.employeeIds.push(employee.id);
  await db.user.update({ where: { id: user.id }, data: { employeeId: employee.id } });

  const visitorName = `Visitante ${stamp}`;
  const visit = await db.visit.create({
    data: { siteId: site.id, gateId: gate.id, hostEmployeeId: employee.id, visitorName, kind: "visit", status: "pending", requestedById: admin.id },
  });
  created.visitIds.push(visit.id);
  // What `notify({ type: "visit_at_gate", employeeIds: [host] })` stores for the host (slice C calls it from the kiosk).
  await db.notification.create({
    data: {
      userId: user.id,
      type: "visit_at_gate",
      payload: { visitId: visit.id, visitorName, company: "Uptime", gateName: gate.name, hostName: employee.name, siteId: site.id },
    },
  });

  await loginAs(page, email, password);
  await expect(page.getByTestId("unread-count")).toHaveText("1");
  await page.getByTestId("notification-bell").click();
  await expect(page).toHaveURL(/\/app\/notifications/);
  await expect(page.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
  const item = page.getByTestId("notification-item").filter({ hasText: visitorName });
  await expect(item).toContainText("Visitante en portería");
  await expect(item).toContainText(`${visitorName} (Uptime) está en ${gate.name}`);
  await expect(item.getByTestId("visit-decision")).toContainText("Pendiente de tu respuesta");

  await item.getByRole("button", { name: "Aprobar" }).click();
  await expect(page.locator("[role=status]").first()).toContainText("Visita aprobada");
  await expect(page.getByTestId("notification-item").filter({ hasText: visitorName }).getByTestId("visit-status")).toContainText("Visita aprobada");
  await expect(page.getByTestId("unread-count")).toHaveCount(0);

  const updated = await db.visit.findUniqueOrThrow({ where: { id: visit.id } });
  expect(updated.status).toBe("approved");
  expect(updated.decidedById).toBe(user.id);
  expect(updated.decidedAt).not.toBeNull();
  const audit = await db.auditLog.findFirst({ where: { action: "visit.approved", targetId: visit.id } });
  expect(audit?.actorId).toBe(user.id);
  const n = await db.notification.findFirst({ where: { userId: user.id, type: "visit_at_gate" } });
  expect(n?.readAt).not.toBeNull();

  // A second decision on the same visit is refused.
  const other = await db.visit.create({
    data: { siteId: site.id, gateId: gate.id, hostEmployeeId: employee.id, visitorName: `Otro ${stamp}`, kind: "visit", status: "pending", requestedById: admin.id },
  });
  created.visitIds.push(other.id);
  await db.notification.create({ data: { userId: user.id, type: "visit_at_gate", payload: { visitId: other.id, visitorName: `Otro ${stamp}`, gateName: gate.name, siteId: site.id } } });
  await db.visit.update({ where: { id: other.id }, data: { status: "timeout" } });
  await page.goto("/app/notifications");
  const otherItem = page.getByTestId("notification-item").filter({ hasText: `Otro ${stamp}` });
  await expect(otherItem.getByTestId("visit-status")).toContainText("Sin respuesta a tiempo");
  await expect(otherItem.getByRole("button", { name: "Aprobar" })).toHaveCount(0);
});

test("preferences page saves quiet hours and email fallback, and validates partial windows", async ({ page }) => {
  const stamp = Date.now();
  const { email, password } = await createLocalHost(`p${stamp}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  created.userIds.push(user.id);
  await loginAs(page, email, password);

  await page.goto("/account");
  await page.getByRole("link", { name: "Notificaciones", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/notifications/);
  await expect(page.getByRole("heading", { name: "Preferencias de notificaciones" })).toBeVisible();
  await expect(page.getByTestId("quiet-summary")).toContainText("Sin horario de silencio");

  await page.getByLabel("Desde").fill("22:00");
  await page.getByLabel("Hasta").fill("07:00");
  await page.getByLabel(/Enviarme un correo/).check();
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.locator("[role=status]").first()).toContainText("Preferencias guardadas");
  await expect(page.getByTestId("quiet-summary")).toContainText("Silencio de 22:00 a 07:00");
  await expect(page.getByLabel(/Enviarme un correo/)).toBeChecked();

  const pref = await db.notificationPref.findUniqueOrThrow({ where: { userId: user.id } });
  expect(pref.quietFrom).toBe("22:00");
  expect(pref.quietTo).toBe("07:00");
  expect(pref.prefs).toMatchObject({ emailFallback: true });

  await page.getByLabel("Hasta").fill("");
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Indica ambas horas");

  await page.getByLabel("Desde").fill("");
  await page.getByLabel("Hasta").fill("");
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByTestId("quiet-summary")).toContainText("Sin horario de silencio");

  // The push section renders; headless Chromium has no push service, so it reports "unsupported" or offers to enable.
  await expect(page.getByTestId("push-subscribe")).toBeVisible();
});

test("/api/push/public-key always serves a VAPID key (variable or server-generated)", async ({ request }) => {
  const res = await request.get("/api/push/public-key");
  expect(res.status()).toBe(200);
  const { publicKey } = await res.json();
  expect(typeof publicKey).toBe("string");
  // Uncompressed P-256 point, base64url: 65 bytes → 87 characters.
  expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
  if (process.env.VAPID_PUBLIC_KEY) expect(publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
  // Stable across calls: the generated pair is persisted, not re-created.
  expect((await (await request.get("/api/push/public-key")).json()).publicKey).toBe(publicKey);
});

test("/api/push/subscribe requires a session and stores the subscription", async ({ page, request }) => {
  const anonymous = await request.post("/api/push/subscribe", { data: { endpoint: "https://push.example/anon", keys: { p256dh: "p", auth: "a" } } });
  expect(anonymous.status()).toBe(401);

  const stamp = Date.now();
  const { email, password } = await createLocalHost(`s${stamp}`);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  created.userIds.push(user.id);
  await loginAs(page, email, password);
  const endpoint = `https://push.example/${stamp}`;
  const ok = await page.request.post("/api/push/subscribe", { data: { endpoint, keys: { p256dh: "BPUBLIC", auth: "AUTH" } } });
  expect(ok.status()).toBe(200);
  expect(await db.pushSubscription.count({ where: { userId: user.id, endpoint } })).toBe(1);
  const bad = await page.request.post("/api/push/subscribe", { data: { endpoint: "nope" } });
  expect(bad.status()).toBe(400);
  const del = await page.request.delete("/api/push/subscribe", { data: { endpoint } });
  expect((await del.json()).removed).toBe(1);
  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
});
