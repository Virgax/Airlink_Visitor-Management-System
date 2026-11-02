import { expect, test, type Page } from "@playwright/test";
import { db } from "./db";
import { loginAsAdmin } from "./helpers";

test.afterAll(async () => db.$disconnect());

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("admin edits a person, manages permissions per site, sets a password and deletes them", async ({ browser, page }) => {
  const stamp = Date.now();
  const email = `editado-${stamp}@airlink.test`;
  await loginAsAdmin(page);

  // Create a manual person with the Security role and a PIN.
  await page.goto("/admin/people");
  await page.getByText("Agregar persona", { exact: true }).first().click();
  await page.locator("#name").fill(`Persona Editable ${stamp}`);
  await page.locator("#email").fill(email);
  await page.locator("#department").fill("Logística");
  await page.locator("#siteId").selectOption({ label: "Airlink 2" });
  await page.getByLabel("Seguridad", { exact: true }).check();
  await page.locator("#pin").fill("7391");
  await page.getByRole("button", { name: "Agregar persona" }).click();
  await expect(page.locator("[role=status]")).toContainText("Persona agregada");

  // Open the edit page from the list.
  await page.goto(`/admin/people?q=${encodeURIComponent(String(stamp))}`);
  await page.getByTestId("person-row").filter({ hasText: email }).getByTestId("edit-person").click();
  await expect(page.getByTestId("person-edit")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Persona Editable ${stamp}`, level: 1 })).toBeVisible();

  // 1. Edit the details.
  await page.locator("#name").fill(`Persona Editada ${stamp}`);
  await page.locator("#department").fill("Calidad");
  await page.locator("#extension").fill("455");
  await page.getByTestId("save-person").click();
  await expect(page.locator("p[role=status]")).toContainText("Datos guardados");
  const employee = await db.employee.findUniqueOrThrow({ where: { email }, include: { user: true } });
  expect(employee.name).toBe(`Persona Editada ${stamp}`);
  expect(employee.department).toBe("Calidad");
  expect(employee.user?.name).toBe(`Persona Editada ${stamp}`);

  // 2. Permissions: add Approver on Airlink 3, remove Security on Airlink 2.
  const memberships = page.getByTestId("memberships");
  await expect(memberships.locator("li")).toHaveCount(1);
  await page.locator("#role").selectOption("approver");
  await page.locator("#roleSiteId").selectOption({ label: "Airlink 3" });
  await page.getByTestId("add-role").click();
  await expect(page.locator("p[role=status]")).toContainText("Permiso agregado");
  await expect(page.getByTestId("memberships").locator("li")).toHaveCount(2);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("memberships").locator('li[data-role="security"]').getByTestId("remove-role").click();
  await expect(page.locator("p[role=status]")).toContainText("Permiso quitado");
  const roles = await db.membership.findMany({ where: { userId: employee.user!.id }, include: { site: true } });
  expect(roles.map((m) => `${m.role}:${m.site?.name}`)).toEqual(["approver:Airlink 3"]);

  // 3. Password: the person can now sign in locally.
  await page.locator("#password").fill(`Nueva-${stamp}-clave!`);
  await page.locator("#confirm").fill(`Nueva-${stamp}-clave!`);
  await page.getByTestId("set-password").click();
  await expect(page.locator("p[role=status]")).toContainText("Contraseña guardada");
  const other = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await login(other, email, `Nueva-${stamp}-clave!`);
  await expect(other).toHaveURL(/\/(app|select-panel)/);
  expect(await db.auditLog.count({ where: { action: "user.password_reset", targetId: employee.user!.id } })).toBe(1);

  // PIN from the edit page returns to the edit page.
  await page.locator("#pin").fill("8642");
  await page.getByRole("button", { name: "Cambiar PIN" }).click();
  await expect(page).toHaveURL(/\/admin\/people\/edit\?/);
  await expect(page.locator("p[role=status]")).toContainText("PIN guardado");

  // 4. Delete: the person has no history, so the row and the account disappear.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-person").click();
  await expect(page).toHaveURL(/\/admin\/people\?ok=deleted/);
  await expect(page.locator("[role=status]")).toContainText("Persona eliminada");
  expect(await db.employee.findUnique({ where: { email } })).toBeNull();
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect(await db.auditLog.count({ where: { action: "person.deleted", targetId: employee.id } })).toBe(1);

  // A person with history cannot be deleted (the host of a pass): the error says to deactivate instead.
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" } });
  const admin = await db.user.findFirstOrThrow({ where: { memberships: { some: { role: "admin" } } } });
  const hostWithHistory = await db.employee.create({ data: { name: `Con Historial ${stamp}`, email: `historial-${stamp}@airlink.test`, siteId: site.id, source: "manual" } });
  await db.pass.create({ data: { siteId: site.id, hostEmployeeId: hostWithHistory.id, createdById: admin.id, kind: "visit", visitorName: "X", validFrom: new Date(), validUntil: new Date(Date.now() + 3_600_000), token: `hist${stamp}abcdefghijkl` } });
  await page.goto(`/admin/people/edit?key=emp:${hostWithHistory.id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("delete-person").click();
  await expect(page.locator("p[role=alert]")).toContainText("tiene historial");
  expect(await db.employee.findUnique({ where: { id: hostWithHistory.id } })).not.toBeNull();
});
