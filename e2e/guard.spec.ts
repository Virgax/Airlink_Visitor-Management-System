import { expect, test, type Browser, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { ADMIN_EMAIL } from "./helpers";
import { hashPassword } from "../src/lib/auth/password";
import { signStaticQr } from "../src/lib/passes/validate";
import { docHash } from "../src/lib/crypto/docHash";

test.setTimeout(180_000);

const SIGNING_KEY = process.env.PASS_SIGNING_KEY!;
const DOC_KEY = process.env.DOC_HASH_KEY!;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(16).toString("base64url");

type Fixture = {
  stamp: number;
  siteA2: { id: string; name: string };
  gateA2: { id: string };
  siteA3: { id: string };
  adminId: string;
  hostId: string;
  hostName: string;
  guardName: string;
  enrollCode: string;
  deviceId: string;
};

async function seedFixture(): Promise<Fixture> {
  const stamp = Date.now();
  const siteA2 = await db.site.findUniqueOrThrow({ where: { slug: "airlink-2" }, select: { id: true, name: true } });
  const siteA3 = await db.site.findUniqueOrThrow({ where: { slug: "airlink-3" }, select: { id: true } });
  const gateA2 = await db.gate.findFirstOrThrow({ where: { siteId: siteA2.id, name: "Recepción" }, select: { id: true } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, select: { id: true } });

  const guardName = `Guardia E2E ${stamp}`;
  await db.user.create({
    data: {
      email: `guard-e2e-${stamp}@airlink.test`,
      name: guardName,
      pinHash: await hashPassword("2468"),
      memberships: { create: { role: "security", siteId: siteA2.id } },
    },
  });
  const enrollCode = `E2E${stamp.toString(36).toUpperCase().slice(-5)}`;
  const device = await db.guardDevice.create({
    data: { siteId: siteA2.id, gateId: gateA2.id, name: `Kiosk E2E ${stamp}`, enrollCodeHash: sha256(enrollCode), enrollExpiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  const hostName = `Anfitrión E2E ${stamp}`;
  const host = await db.employee.create({ data: { name: hostName, department: "Logística", siteId: siteA2.id, source: "manual" } });

  return { stamp, siteA2, gateA2, siteA3, adminId: admin.id, hostId: host.id, hostName, guardName, enrollCode, deviceId: device.id };
}

async function makePass(
  f: Fixture,
  opts: { name: string; siteId?: string; validFrom?: Date; validUntil?: Date; qrExp?: Date; docHash?: string; kind?: "visit" | "carrier"; companyName?: string },
) {
  const validFrom = opts.validFrom ?? new Date(Date.now() - 3600_000);
  const validUntil = opts.validUntil ?? new Date(Date.now() + 4 * 3600_000);
  const siteId = opts.siteId ?? f.siteA2.id;
  const company = opts.companyName ? await db.company.upsert({ where: { name: opts.companyName }, create: { name: opts.companyName }, update: {} }) : null;
  const pass = await db.pass.create({
    data: {
      siteId,
      hostEmployeeId: f.hostId,
      createdById: f.adminId,
      visitorName: opts.name,
      kind: opts.kind ?? "visit",
      companyId: company?.id ?? null,
      validFrom,
      validUntil,
      token: token(),
      status: "active",
      maxUses: 1,
      visitorDocHash: opts.docHash ?? null,
      visitorDocLast4: opts.docHash ? "5678" : null,
    },
  });
  const payload = signStaticQr({ passId: pass.id, exp: (opts.qrExp ?? validUntil).getTime() / 1000, siteId }, SIGNING_KEY);
  return { id: pass.id, payload };
}

async function openKiosk(browser: Browser, f: Fixture): Promise<Page> {
  const ctx = await browser.newContext({ locale: "es-DO" });
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

test("kiosk scans passes: green entry, inside list and check-out, denials with reasons, offline dedupe", async ({ browser }) => {
  const f = await seedFixture();
  const valid = await makePass(f, { name: `Visitante Verde ${f.stamp}`, companyName: `Uptime E2E ${f.stamp}` });
  const expired = await makePass(f, { name: `Visitante Vencido ${f.stamp}`, validUntil: new Date(Date.now() - 3600_000), qrExp: new Date(Date.now() + 3600_000) });
  const blockedDoc = docHash(`001-${f.stamp}-5678`, DOC_KEY);
  await db.blacklist.create({ data: { siteId: null, docHash: blockedDoc, reason: "E2E", createdById: f.adminId } });
  const blacklisted = await makePass(f, { name: `Visitante Vetado ${f.stamp}`, docHash: blockedDoc });
  const otherSite = await makePass(f, { name: `Visitante A3 ${f.stamp}`, siteId: f.siteA3.id });
  const queued = await makePass(f, { name: `Visitante Offline ${f.stamp}` });

  const k = await openKiosk(browser, f);
  await k.getByRole("link", { name: "Escanear QR" }).click();
  await expect(k.getByRole("heading", { name: "Escanear QR" })).toBeVisible();

  // Valid pass → green, visit inside
  let result = await scanManually(k, valid.payload);
  await expect(result).toHaveAttribute("data-tone", "ok");
  await expect(result).toContainText("Entrada registrada");
  await expect(result).toContainText(`Visitante Verde ${f.stamp}`);
  await expect(result).toContainText(f.hostName);
  await expect(result).toContainText(`Uptime E2E ${f.stamp}`);
  const entered = await db.visit.findFirstOrThrow({ where: { passId: valid.id } });
  expect(entered.status).toBe("inside");
  expect(entered.enteredAt).not.toBeNull();
  expect(await db.auditLog.count({ where: { action: "visit.entered", targetId: entered.id } })).toBe(1);
  await k.getByRole("button", { name: "Escanear otro" }).click();

  // Expired pass → red with reason
  result = await scanManually(k, expired.payload);
  await expect(result).toHaveAttribute("data-tone", "deny");
  await expect(result).toHaveAttribute("data-reason", "expired");
  await expect(result).toContainText("El pase venció");
  await k.getByRole("button", { name: "Escanear otro" }).click();

  // Blacklisted document → red + audit row
  result = await scanManually(k, blacklisted.payload);
  await expect(result).toHaveAttribute("data-reason", "blacklisted");
  await expect(result).toContainText("lista negra");
  expect(await db.auditLog.count({ where: { action: "blacklist.hit", targetId: blacklisted.id } })).toBe(1);
  expect(await db.visit.count({ where: { passId: blacklisted.id } })).toBe(0);
  await k.getByRole("button", { name: "Escanear otro" }).click();

  // Pass from Airlink 3 at an Airlink 2 kiosk → wrong_site
  result = await scanManually(k, otherSite.payload);
  await expect(result).toHaveAttribute("data-reason", "wrong_site");
  await expect(result).toContainText("otro sitio");
  await k.getByRole("button", { name: "Escanear otro" }).click();

  // Same scanId posted twice (offline queue flushed twice) → one Visit, second answer flagged duplicate
  const scanId = `e2e-${f.stamp}-dup`;
  const at = new Date().toISOString();
  const first = await k.request.post("/api/guard/scan", { data: { payload: queued.payload, scanId, at, offline: true } });
  expect(first.ok()).toBeTruthy();
  const firstBody = await first.json();
  expect(firstBody.ok).toBe(true);
  expect(firstBody.action).toBe("entered");
  expect(firstBody.duplicate).toBeFalsy();
  const second = await k.request.post("/api/guard/scan", { data: { payload: queued.payload, scanId, at, offline: true } });
  const secondBody = await second.json();
  expect(secondBody.ok).toBe(true);
  expect(secondBody.duplicate).toBe(true);
  expect(secondBody.visit.id).toBe(firstBody.visit.id);
  expect(await db.visit.count({ where: { scanId } })).toBe(1);
  expect(await db.visit.count({ where: { passId: queued.id } })).toBe(1);

  // Second scan of a pass with an open visit marks the exit instead of denying
  result = await scanManually(k, queued.payload);
  await expect(result).toHaveAttribute("data-tone", "left");
  await expect(result).toContainText("Salida registrada");
  const leftVisit = await db.visit.findUniqueOrThrow({ where: { scanId } });
  expect(leftVisit.status).toBe("left");
  expect(leftVisit.leftAt).not.toBeNull();

  // Inside list shows the first visitor; check-out button
  await k.goto("/guard/inside");
  const row = k.getByTestId("inside-visit").filter({ hasText: `Visitante Verde ${f.stamp}` });
  await expect(row).toHaveCount(1);
  await expect(k.getByTestId("inside-visit").filter({ hasText: `Visitante Offline ${f.stamp}` })).toHaveCount(0);
  await row.getByRole("button", { name: "Marcar salida" }).click();
  await expect(k.locator("[role=status]")).toContainText("Salida registrada");
  await expect(k.getByTestId("inside-visit").filter({ hasText: `Visitante Verde ${f.stamp}` })).toHaveCount(0);
  const checkedOut = await db.visit.findUniqueOrThrow({ where: { id: entered.id } });
  expect(checkedOut.status).toBe("left");
  expect(checkedOut.leftAt).not.toBeNull();
  expect(await db.auditLog.count({ where: { action: "visit.left", targetId: entered.id } })).toBe(1);

  await k.context().close();
});

test("unannounced visit: host search, pending list, guard override, evacuation list", async ({ browser }) => {
  const f = await seedFixture();
  const k = await openKiosk(browser, f);

  await k.getByRole("link", { name: "Visita no anunciada" }).click();
  await expect(k.getByRole("heading", { name: "Visita no anunciada" })).toBeVisible();
  await k.getByLabel("Anfitrión").fill(`E2E ${f.stamp}`);
  await k.getByTestId("host-results").getByRole("button", { name: new RegExp(f.hostName) }).click();
  await expect(k.getByTestId("host-selected")).toContainText(f.hostName);
  const visitor = `Mensajero ${f.stamp}`;
  await k.getByLabel("Nombre del visitante").fill(visitor);
  await k.getByLabel("Empresa").fill(`Courier E2E ${f.stamp}`);
  await k.getByLabel("Tipo de visita").selectOption("delivery");
  await k.getByLabel("Cédula o pasaporte").fill("402-1234567-8");
  await k.getByRole("button", { name: "Avisar al anfitrión" }).click();
  await expect(k.locator("[role=status]").first()).toContainText("Visita registrada");

  const pending = await db.visit.findFirstOrThrow({ where: { visitorName: visitor } });
  expect(pending.status).toBe("pending");
  expect(pending.hostEmployeeId).toBe(f.hostId);
  expect(pending.docLast4).toBe("5678");
  expect(pending.docHash).toBe(docHash("402-1234567-8", DOC_KEY));

  const card = k.getByTestId("pending-visit").filter({ hasText: visitor });
  await expect(card).toHaveAttribute("data-status", "pending");
  await card.getByRole("button", { name: "Aprobado en persona" }).click();
  await expect(k.getByTestId("pending-visit").filter({ hasText: visitor })).toHaveCount(0);
  const approved = await db.visit.findUniqueOrThrow({ where: { id: pending.id } });
  expect(approved.status).toBe("inside");
  expect(approved.enteredAt).not.toBeNull();
  expect(await db.auditLog.count({ where: { action: "visit.approved", targetId: pending.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "visit.entered", targetId: pending.id } })).toBe(1);

  // Evacuation list includes the visitor, grouped under the host
  await k.goto("/guard/evacuation");
  await expect(k.getByTestId("evacuation")).toContainText(visitor);
  await expect(k.getByTestId("evacuation")).toContainText(f.hostName);
  await expect(k.getByRole("button", { name: "Imprimir" })).toBeVisible();

  // Deny path for a second unannounced visit
  await k.goto("/guard/unannounced");
  await k.getByLabel("Anfitrión").fill(`E2E ${f.stamp}`);
  await k.getByTestId("host-results").getByRole("button", { name: new RegExp(f.hostName) }).click();
  const visitor2 = `Rechazado ${f.stamp}`;
  await k.getByLabel("Nombre del visitante").fill(visitor2);
  await k.getByRole("button", { name: "Avisar al anfitrión" }).click();
  const card2 = k.getByTestId("pending-visit").filter({ hasText: visitor2 });
  await card2.getByRole("button", { name: "Rechazar" }).click();
  await expect(card2).toHaveAttribute("data-status", "denied");
  const denied = await db.visit.findFirstOrThrow({ where: { visitorName: visitor2 } });
  expect(denied.status).toBe("denied");

  await k.context().close();
});
