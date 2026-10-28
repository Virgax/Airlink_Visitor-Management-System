import { expect, test, type Browser, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { ADMIN_EMAIL } from "./helpers";
import { hashPassword } from "../src/lib/auth/password";
import { signStaticQr } from "../src/lib/passes/validate";
import { signVisitQr } from "../src/lib/badges/visitQr";
import { badgeSeq } from "../src/lib/badges/badgeNo";

test.setTimeout(180_000);

const SIGNING_KEY = process.env.PASS_SIGNING_KEY!;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(16).toString("base64url");

type Fixture = { stamp: number; siteId: string; gateId: string; adminId: string; hostId: string; hostName: string; guardName: string; enrollCode: string };

async function seedFixture(): Promise<Fixture> {
  const stamp = Date.now();
  const site = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" }, select: { id: true } });
  const gate = await db.gate.findFirstOrThrow({ where: { siteId: site.id, name: "Recepción" }, select: { id: true } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  const guardName = `Guardia Gafete ${stamp}`;
  await db.user.create({
    data: { email: `guard-badge-${stamp}@airlink.test`, name: guardName, pinHash: await hashPassword("2468"), memberships: { create: { role: "security", siteId: site.id } } },
  });
  const enrollCode = `BDG${stamp.toString(36).toUpperCase().slice(-5)}`;
  await db.guardDevice.create({
    data: { siteId: site.id, gateId: gate.id, name: `Kiosk Gafete ${stamp}`, enrollCodeHash: sha256(enrollCode), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  const hostName = `Anfitrión Gafete ${stamp}`;
  const host = await db.employee.create({ data: { name: hostName, department: "IQC", siteId: site.id, source: "manual" } });
  return { stamp, siteId: site.id, gateId: gate.id, adminId: admin.id, hostId: host.id, hostName, guardName, enrollCode };
}

async function makePass(f: Fixture, name: string, companyName: string) {
  const validFrom = new Date(Date.now() - 3600_000);
  const validUntil = new Date(Date.now() + 4 * 3600_000);
  const company = await db.company.upsert({ where: { name: companyName }, create: { name: companyName }, update: {} });
  const pass = await db.pass.create({
    data: { siteId: f.siteId, hostEmployeeId: f.hostId, createdById: f.adminId, visitorName: name, kind: "visit", companyId: company.id, validFrom, validUntil, token: token(), status: "active", maxUses: 1, visitorDocLast4: "4321" },
  });
  return { id: pass.id, payload: signStaticQr({ passId: pass.id, exp: validUntil.getTime() / 1000, siteId: f.siteId }, SIGNING_KEY) };
}

async function openKiosk(browser: Browser, f: Fixture): Promise<Page> {
  const ctx = await browser.newContext({ locale: "es-DO", acceptDownloads: true });
  const k = await ctx.newPage();
  await k.goto("/guard");
  await k.getByLabel("Código").fill(f.enrollCode);
  await k.getByRole("button", { name: "Enrolar" }).click();
  await expect(k.getByRole("heading", { name: "Entrar con PIN" })).toBeVisible();
  await k.locator("#userId").selectOption({ label: f.guardName });
  await k.getByLabel("PIN").fill("2468");
  await k.getByRole("button", { name: "Entrar" }).click();
  await expect(k.getByRole("heading", { name: "Modo kiosco" })).toBeVisible();
  return k;
}

async function scanManually(k: Page, payload: string) {
  await k.getByTestId("manual-payload").fill(payload);
  await k.getByRole("button", { name: "Validar" }).click();
  const result = k.getByTestId("scan-result");
  await expect(result).toBeVisible();
  return result;
}

test("badge: green scan shows the badge step with number and preview, ZPL route, reprint from the inside list, badge QR checks out", async ({ browser }) => {
  const f = await seedFixture();
  const first = await makePass(f, `Visitante Gafete ${f.stamp}`, `Uptime Gafete ${f.stamp}`);
  const second = await makePass(f, `Segundo Gafete ${f.stamp}`, `Uptime Gafete ${f.stamp}`);

  const k = await openKiosk(browser, f);
  await k.goto("/guard/scan");
  await expect(k.getByRole("heading", { name: "Escanear QR" })).toBeVisible();

  // Green scan → badge panel with the number and the preview (no bucket in e2e: the photo step is skipped).
  const result = await scanManually(k, first.payload);
  await expect(result).toHaveAttribute("data-tone", "ok");
  const panel = k.getByTestId("badge-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-phase", "preview");
  const preview = k.getByTestId("badge-preview");
  await expect(preview).toContainText(`Visitante Gafete ${f.stamp}`);
  await expect(preview).toContainText(`Uptime Gafete ${f.stamp}`);
  await expect(preview).toContainText(f.hostName);
  await expect(preview).toContainText("****4321");
  const badgeNo = (await k.getByTestId("badge-number").textContent())!.trim();
  expect(badgeNo).toMatch(/^A2R-\d{4}$/);
  await expect(preview.getByTestId("badge-no")).toContainText(`Gafete #${badgeNo}`);

  const visit = await db.visit.findFirstOrThrow({ where: { passId: first.id } });
  expect(visit.status).toBe("inside");
  expect(visit.badgeNo).toBe(badgeNo);

  // Badge print without a printer on the gate: downloads the ZPL and audits `badge.printed`.
  const [download] = await Promise.all([k.waitForEvent("download"), k.getByTestId("badge-print").click()]);
  expect(download.suggestedFilename()).toBe(`badge-${badgeNo}.zpl`);
  await expect(k.locator("[role=status]").filter({ hasText: "se descargó el archivo ZPL" })).toBeVisible();
  expect(await db.auditLog.count({ where: { action: "badge.printed", targetId: visit.id } })).toBe(1);

  // ZPL route: label setup, visitor name, QR.
  const zplRes = await k.request.get(`/api/guard/badges/${visit.id}/zpl?audit=0`);
  expect(zplRes.ok()).toBeTruthy();
  expect(zplRes.headers()["content-type"]).toContain("text/plain");
  const zpl = await zplRes.text();
  expect(zpl).toContain("^XA");
  expect(zpl).toContain("^MNY");
  expect(zpl).toContain("^PW812");
  expect(zpl).toContain(`Visitante Gafete ${f.stamp}`);
  expect(zpl).toContain("^BQN,2,6");
  expect(zpl).toContain(`#${badgeNo}`);
  expect(zpl).toContain(signVisitQr({ visitId: visit.id, siteId: f.siteId }, SIGNING_KEY));

  // Second visitor of the day gets the next number at this site.
  await k.getByTestId("badge-done").click();
  await expect(k.getByTestId("badge-panel")).toHaveCount(0);
  await scanManually(k, second.payload);
  await expect(k.getByTestId("badge-panel")).toHaveAttribute("data-phase", "preview");
  const secondNo = (await k.getByTestId("badge-number").textContent())!.trim();
  expect(badgeSeq(secondNo)).toBe(badgeSeq(badgeNo)! + 1);

  // Reprint from the inside list → audited as badge.reprinted.
  await k.goto("/guard/inside");
  const row = k.getByTestId("inside-visit").filter({ hasText: `Visitante Gafete ${f.stamp}` });
  await expect(row).toContainText(badgeNo);
  await row.getByTestId("reprint-badge").click();
  await expect(k.getByRole("heading", { level: 1, name: "Reimprimir gafete" })).toBeVisible();
  await expect(k.getByTestId("badge-panel")).toHaveAttribute("data-phase", "preview");
  await expect(k.getByTestId("badge-preview")).toContainText(`Visitante Gafete ${f.stamp}`);
  const [reprintDownload] = await Promise.all([k.waitForEvent("download"), k.getByTestId("badge-print").click()]);
  expect(reprintDownload.suggestedFilename()).toBe(`badge-${badgeNo}.zpl`);
  expect(await db.auditLog.count({ where: { action: "badge.reprinted", targetId: visit.id } })).toBe(1);
  await k.getByTestId("badge-done").click();
  await expect(k.getByRole("heading", { name: "Dentro ahora" })).toBeVisible();

  // Scanning the badge QR at the kiosk checks the visitor out; a second scan reports the badge as closed.
  const badgePayload = signVisitQr({ visitId: visit.id, siteId: f.siteId }, SIGNING_KEY);
  await k.goto("/guard/scan");
  let out = await scanManually(k, badgePayload);
  await expect(out).toHaveAttribute("data-tone", "left");
  await expect(out).toContainText("Salida registrada");
  await expect(out).toContainText(`Visitante Gafete ${f.stamp}`);
  const left = await db.visit.findUniqueOrThrow({ where: { id: visit.id } });
  expect(left.status).toBe("left");
  expect(left.leftAt).not.toBeNull();
  expect(await db.auditLog.count({ where: { action: "visit.left", targetId: visit.id } })).toBe(1);
  // A tampered badge QR is rejected (and, being a different payload, clears the kiosk's same-payload debounce).
  await k.getByRole("button", { name: "Escanear otro" }).click();
  out = await scanManually(k, `${visit.id}.${"A".repeat(22)}`);
  await expect(out).toHaveAttribute("data-reason", "bad_signature");

  await k.getByRole("button", { name: "Escanear otro" }).click();
  out = await scanManually(k, badgePayload);
  await expect(out).toHaveAttribute("data-reason", "visit_closed");

  await k.context().close();
});

test("badge: in-person approval of an unannounced visit numbers the badge; another site cannot read it", async ({ browser }) => {
  const f = await seedFixture();
  const k = await openKiosk(browser, f);
  const guard = await db.user.findFirstOrThrow({ where: { name: f.guardName }, select: { id: true } });
  const pending = await db.visit.create({
    data: { siteId: f.siteId, gateId: f.gateId, requestedById: guard.id, hostEmployeeId: f.hostId, visitorName: `Sin pase ${f.stamp}`, kind: "visit", status: "pending" },
  });

  const res = await k.request.post("/api/guard/visits", { data: { visitId: pending.id, action: "approve_in_person" } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.visit.status).toBe("inside");
  expect(body.badge.visitId).toBe(pending.id);
  expect(body.badge.badgeNo).toMatch(/^A2R-\d{4}$/);
  expect(body.badge.autoPrint).toBe(false);

  // Policies that print no badge (delivery) get no badge step.
  const delivery = await db.visit.create({
    data: { siteId: f.siteId, gateId: f.gateId, requestedById: guard.id, hostEmployeeId: f.hostId, visitorName: `Entrega ${f.stamp}`, kind: "delivery", status: "pending" },
  });
  const res2 = await k.request.post("/api/guard/visits", { data: { visitId: delivery.id, action: "approve_in_person" } });
  expect((await res2.json()).badge).toBeUndefined();

  // Visits of another site are invisible to this kiosk.
  const siteA3 = await db.site.findUniqueOrThrow({ where: { slug: "airlink-3" }, select: { id: true } });
  const gateA3 = await db.gate.findFirstOrThrow({ where: { siteId: siteA3.id }, select: { id: true } });
  const other = await db.visit.create({
    data: { siteId: siteA3.id, gateId: gateA3.id, requestedById: guard.id, visitorName: `Otro sitio ${f.stamp}`, kind: "visit", status: "inside", enteredAt: new Date() },
  });
  expect((await k.request.get(`/api/guard/badges/${other.id}`)).status()).toBe(404);
  expect((await k.request.get(`/api/guard/badges/${other.id}/zpl`)).status()).toBe(404);
  expect(await db.auditLog.count({ where: { targetId: other.id } })).toBe(0);

  // The print queue needs an agent printer on the gate (none in the seed) and the agent needs a valid signature.
  const enqueue = await k.request.post("/api/print/enqueue", { data: { visitId: pending.id } });
  expect(enqueue.status()).toBe(409);
  const jobs = await k.request.get(`/api/print/jobs?gate=${f.gateId}`, { headers: { "x-timestamp": String(Math.floor(Date.now() / 1000)), "x-signature": "00" } });
  expect(jobs.status()).toBe(401);

  await k.context().close();
});
