/**
 * Idempotent seed, run on every deploy (start:prod) under an advisory lock.
 * Creates: sites Airlink 2 / Airlink 3 with gates and areas, default visit policies, NDA v1,
 * and the break-glass admin from SEED_ADMIN_EMAIL (+ SEED_ADMIN_PASSWORD on first creation).
 */
import "dotenv/config";
import { PrismaClient, type Prisma, type VisitKind } from "@prisma/client";
import { randomBytes, scrypt as scryptCb } from "node:crypto";

const db = new PrismaClient();

function scrypt(password: string, salt: Buffer, keylen: number, opts: { N: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, { N: 16384 });
  return `scrypt$16384$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const KINDS: VisitKind[] = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"];

const DEFAULTS: Record<VisitKind, { requiresApproval: boolean; approverRole: "security" | "approver" | null; requiresDoc: boolean; requiresNda: boolean; escortRequired: boolean; badge: boolean; maxDurationMin: number | null; receptionOnly: boolean }> = {
  visit: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: true, maxDurationMin: null, receptionOnly: false },
  candidate: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: true, badge: true, maxDurationMin: 240, receptionOnly: false },
  contractor: { requiresApproval: true, approverRole: "security", requiresDoc: true, requiresNda: true, escortRequired: true, badge: true, maxDurationMin: null, receptionOnly: false },
  vendor: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: true, maxDurationMin: null, receptionOnly: false },
  auditor: { requiresApproval: true, approverRole: "approver", requiresDoc: true, requiresNda: true, escortRequired: true, badge: true, maxDurationMin: null, receptionOnly: false },
  carrier: { requiresApproval: false, approverRole: null, requiresDoc: true, requiresNda: false, escortRequired: false, badge: false, maxDurationMin: 180, receptionOnly: false },
  delivery: { requiresApproval: false, approverRole: null, requiresDoc: false, requiresNda: false, escortRequired: false, badge: false, maxDurationMin: 30, receptionOnly: true },
  recurring: { requiresApproval: true, approverRole: "security", requiresDoc: true, requiresNda: true, escortRequired: false, badge: true, maxDurationMin: null, receptionOnly: false },
};

const SITES = [
  { slug: "airlink-2", name: "Airlink 2", gates: [{ name: "Recepción", kind: "pedestrian" as const }, { name: "Muelle", kind: "dock" as const }], areas: ["Oficinas", "IQC", "Almacén", "Producción"] },
  { slug: "airlink-3", name: "Airlink 3", gates: [{ name: "Recepción", kind: "pedestrian" as const }], areas: ["Oficinas", "Producción"] },
];

async function seedSites() {
  for (const s of SITES) {
    const site = await db.site.upsert({
      where: { slug: s.slug },
      create: { slug: s.slug, name: s.name, settings: { retentionDays: 90, unannouncedTimeoutMin: 5 } },
      update: {},
    });
    for (const g of s.gates) {
      const existing = await db.gate.findFirst({ where: { siteId: site.id, name: g.name } });
      if (!existing) await db.gate.create({ data: { siteId: site.id, name: g.name, kind: g.kind } });
    }
    for (const name of s.areas) {
      await db.area.upsert({
        where: { siteId_name: { siteId: site.id, name } },
        create: { siteId: site.id, name, restricted: name === "IQC", escortRequired: name === "IQC" || name === "Producción" },
        update: {},
      });
    }
    for (const kind of KINDS) {
      await db.visitPolicy.upsert({
        where: { siteId_kind: { siteId: site.id, kind } },
        create: { siteId: site.id, kind, ...DEFAULTS[kind] },
        update: {},
      });
    }
  }
}

async function seedNda() {
  const existing = await db.ndaVersion.findFirst({ where: { siteId: null, version: "1.0" } });
  if (existing) return;
  await db.ndaVersion.create({
    data: {
      siteId: null,
      version: "1.0",
      title: "Política de visitantes y confidencialidad",
      body:
        "Al ingresar a las instalaciones de Airlink Distribution DR acepto: (1) portar el gafete visible y permanecer acompañado en las áreas que lo requieran; " +
        "(2) no tomar fotografías ni video sin autorización; (3) mantener confidencial toda información, proceso o dispositivo que observe; " +
        "(4) seguir las indicaciones de Seguridad y las normas de seguridad industrial; (5) que mis datos se usen únicamente para el control de acceso según la Ley 172-13.",
    },
  });
}

const DEFAULT_ADMIN_EMAIL = "admin@airlinkdr.com";

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL).toLowerCase();
  let user = await db.user.findUnique({ where: { email } });
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!user) {
    let password = envPassword;
    let generated = false;
    if (!password) {
      password = randomBytes(12).toString("base64url");
      generated = true;
    }
    user = await db.user.create({ data: { email, name: "Administrador", passwordHash: await hashPassword(password) } });
    console.log(`[seed] created admin ${email}`);
    if (generated) {
      // Printed exactly once, at creation. Change it in /account right after the first sign-in.
      console.log(`[seed] initial admin password (change it now): ${password}`);
    }
  } else if (envPassword && process.env.SEED_ADMIN_RESET_PASSWORD === "1") {
    // Recovery: set SEED_ADMIN_PASSWORD + SEED_ADMIN_RESET_PASSWORD=1 in Railway, redeploy, then remove both.
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(envPassword), totpSecret: null, status: "active" } });
    await db.session.deleteMany({ where: { userId: user.id } });
    console.warn(`[seed] admin password for ${email} was RESET from SEED_ADMIN_PASSWORD; remove SEED_ADMIN_RESET_PASSWORD now`);
  }
  await db.membership.upsert({
    where: { userId_siteId_role: { userId: user.id, siteId: null as unknown as string, role: "admin" } },
    create: { userId: user.id, siteId: null, role: "admin" },
    update: {},
  }).catch(async () => {
    // Prisma cannot match NULL in a compound unique; fall back to findFirst
    const m = await db.membership.findFirst({ where: { userId: user!.id, siteId: null, role: "admin" } });
    if (!m) await db.membership.create({ data: { userId: user!.id, siteId: null, role: "admin" } });
  });
}

/** Pre-generates the server secrets so the first request does not have to. Env variables take precedence. */
async function seedSecrets(tx: Prisma.TransactionClient) {
  const names = ["APP_ENCRYPTION_KEY", "PASS_SIGNING_KEY", "DOC_HASH_KEY", "SESSION_SECRET", "CRON_SECRET", "SYNC_SECRET", "PRINT_AGENT_SECRET", "TEAMS_ACTION_SECRET"];
  const existing = new Set((await tx.systemSecret.findMany({ select: { name: true } })).map((r) => r.name));
  const data = names.filter((n) => !existing.has(n) && !process.env[n]).map((name) => ({ name, value: randomBytes(32).toString("base64") }));
  if (!existing.has("VAPID_PUBLIC_KEY") && !process.env.VAPID_PUBLIC_KEY) {
    const wp = await import("web-push");
    const generateVAPIDKeys = (wp as { generateVAPIDKeys?: typeof wp.default.generateVAPIDKeys }).generateVAPIDKeys ?? wp.default.generateVAPIDKeys;
    const pair = generateVAPIDKeys();
    data.push({ name: "VAPID_PUBLIC_KEY", value: pair.publicKey }, { name: "VAPID_PRIVATE_KEY", value: pair.privateKey });
  }
  if (data.length) {
    await tx.systemSecret.createMany({ data, skipDuplicates: true });
    console.log(`[seed] generated ${data.length} server secrets`);
  }
}

async function main() {
  // 63-bit lock id for "seed"
  const locked = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(7355608001) AS locked`;
    if (!rows[0]?.locked) return false;
    await seedSites();
    await seedNda();
    await seedAdmin();
    await seedSecrets(tx);
    return true;
  }, { timeout: 120_000 });
  console.log(locked ? "[seed] done" : "[seed] skipped (another replica is seeding)");
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
