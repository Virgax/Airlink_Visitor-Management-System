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

test("guest Wi-Fi on invitations, validity renewal, 'requires photo' policy and the walk-in switch", async ({ browser, page }) => {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-3" } });
  const reception = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" } });

  // 1. Admin: guest Wi-Fi, walk-ins off, "requires photo" on visits (no media bucket here, so it never blocks).
  await loginAsAdmin(page);
  await page.goto(`/admin/sites/${site.id}`);
  await page.getByLabel("Red Wi-Fi de invitados").fill("ARL Guest");
  await page.getByLabel("Clave del Wi-Fi de invitados").fill(`clave-${stamp}`);
  await page.getByTestId("allow-unannounced").uncheck();
  await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page).toHaveURL(/ok=saved/);
  const settings = (await db.site.findUniqueOrThrow({ where: { id: site.id } })).settings as { guestWifi: { ssid: string }; allowUnannounced: boolean };
  expect(settings.guestWifi.ssid).toBe("ARL Guest");
  expect(settings.allowUnannounced).toBe(false);
  await page.goto(`/admin/policies?site=${site.id}`);
  const visitPolicy = page.getByTestId("policy-visit");
  await visitPolicy.getByLabel("Pide foto de la cara").check();
  await visitPolicy.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/ok=saved/);
  expect((await db.visitPolicy.findUniqueOrThrow({ where: { siteId_kind: { siteId: site.id, kind: "visit" } } })).requiresPhoto).toBe(true);

  // 2. Host shares the Wi-Fi on an invitation; the visitor sees it on the link.
  const host = await createLocalHost(stamp);
  const h = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await login(h, host.email, host.password);
  await h.goto(`/app/passes/new?siteId=${site.id}`);
  await h.getByLabel("Tipo de visita").selectOption("visit");
  await h.getByLabel("Nombre del visitante").fill(`Visita Wifi ${stamp}`);
  await h.getByLabel("Cédula o pasaporte").fill("001-1234567-8");
  await h.getByLabel("Válido desde").fill(localDate(0, "08:00"));
  await h.getByLabel("Válido hasta").fill(localDate(0, "09:00"));
  await h.getByTestId("share-wifi").check();
  await h.getByRole("button", { name: "Crear pase" }).click();
  await expect(h).toHaveURL(/\?ok=created$/);
  await expect(h.getByText("Compartido en el enlace")).toBeVisible();
  const token = (await h.getByTestId("visitor-link").inputValue()).split("/v/")[1]!;
  const v = await (await browser.newContext({ locale: "es-DO" })).newPage();
  await v.goto(`/v/${token}`);
  await expect(v.getByTestId("guest-wifi")).toContainText("ARL Guest");
  await expect(v.getByTestId("guest-wifi")).toContainText(`clave-${stamp}`);

  // 3. The visitor shows up after the window: the host renews the validity, same link, and the kiosk lets them in.
  const pass = await db.pass.findUniqueOrThrow({ where: { token } });
  await db.pass.update({ where: { id: pass.id }, data: { validFrom: new Date(Date.now() - 3 * 3_600_000), validUntil: new Date(Date.now() - 2 * 3_600_000) } });
  const guardName = `Guardia Ops ${stamp}`;
  await db.user.create({ data: { email: `guard-ops-${stamp}@airlink.test`, name: guardName, pinHash: await hashPassword("2468"), memberships: { create: { role: "security", siteId: site.id } } } });
  const code = `OP${stamp.toString(36).toUpperCase().slice(-6)}`;
  await db.guardDevice.create({ data: { siteId: site.id, gateId: reception.id, name: `Kiosk Ops ${stamp}`, enrollCodeHash: sha256(code), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  const k = await openKiosk(browser, code, guardName);
  await expect(k.getByRole("link", { name: "Visita no anunciada" })).toHaveCount(0);
  await k.goto("/guard/unannounced");
  await expect(k).toHaveURL(/\/guard$/);
  const payload = signStaticQr({ passId: pass.id, exp: Math.floor((Date.now() + 86_400_000) / 1000), siteId: site.id }, SIGNING_KEY);
  await k.goto("/guard/scan");
  await k.getByTestId("manual-payload").fill(payload);
  await k.getByRole("button", { name: "Validar" }).click();
  await expect(k.getByTestId("scan-result")).toHaveAttribute("data-reason", "expired");

  await h.goto(`/app/passes/${pass.id}`);
  await h.locator("#windowFrom").fill(localDate(-1, "00:00"));
  await h.locator("#windowUntil").fill(localDate(1, "23:00"));
  await h.getByTestId("save-window").click();
  await expect(h.locator("[role=status]")).toContainText("Vigencia actualizada");
  expect(await db.auditLog.count({ where: { action: "pass.updated", targetId: pass.id } })).toBeGreaterThanOrEqual(1);
  await k.goto("/guard/scan");
  await k.getByTestId("manual-payload").fill(payload);
  await k.getByRole("button", { name: "Validar" }).click();
  await expect(k.getByTestId("scan-result")).toHaveAttribute("data-tone", "ok");

  // Leave the site as it was for the other specs.
  await db.site.update({ where: { id: site.id }, data: { settings: { ...settings, allowUnannounced: true, guestWifi: { ssid: "", password: "" } } } });
  await db.visitPolicy.update({ where: { siteId_kind: { siteId: site.id, kind: "visit" } }, data: { requiresPhoto: false } });
});
