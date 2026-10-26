import { expect, test } from "@playwright/test";

test("health endpoints respond", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.ok()).toBeTruthy();
  const ready = await request.get("/api/health/ready");
  expect(ready.ok()).toBeTruthy();
  expect(await ready.json()).toMatchObject({ ok: true, db: "up" });
});

test("cron tick requires the secret", async ({ request }) => {
  expect((await request.post("/api/cron/tick")).status()).toBe(401);
  const ok = await request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "dev-cron-secret"}` } });
  expect(ok.ok()).toBeTruthy();
  expect(await ok.json()).toMatchObject({ ok: true, ran: true });
});

test("security headers and manifest are served", async ({ page }) => {
  const res = await page.goto("/login");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBe("Airlink Visitas");
});
