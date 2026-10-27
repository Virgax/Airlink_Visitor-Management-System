import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

export const SECRET_NAMES = [
  "APP_ENCRYPTION_KEY",
  "PASS_SIGNING_KEY",
  "DOC_HASH_KEY",
  "SESSION_SECRET",
  "CRON_SECRET",
  "SYNC_SECRET",
  "PRINT_AGENT_SECRET",
  "TEAMS_ACTION_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const MIN_LENGTH = 8;
const LOCK_ID = 7355608002n;
const cache = new Map<SecretName, string>();

/**
 * Returns a secret by name. Order: environment variable (Railway) → cached → SystemSecret row →
 * generated under an advisory lock on first use. Values are never logged.
 */
export async function getSecret(name: SecretName): Promise<string> {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length >= MIN_LENGTH) return fromEnv;
  const hit = cache.get(name);
  if (hit) return hit;

  const row = await db.systemSecret.findUnique({ where: { name } });
  if (row) {
    cache.set(name, row.value);
    return row.value;
  }

  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
    const again = await tx.systemSecret.findUnique({ where: { name } });
    if (again) return again.value;
    if (name === "VAPID_PUBLIC_KEY" || name === "VAPID_PRIVATE_KEY") {
      const wp = await import("web-push");
    const generateVAPIDKeys = (wp as { generateVAPIDKeys?: typeof wp.default.generateVAPIDKeys }).generateVAPIDKeys ?? wp.default.generateVAPIDKeys;
      const pair = generateVAPIDKeys();
      await tx.systemSecret.createMany({
        data: [
          { name: "VAPID_PUBLIC_KEY", value: pair.publicKey },
          { name: "VAPID_PRIVATE_KEY", value: pair.privateKey },
        ],
        skipDuplicates: true,
      });
      log.info("secrets.generated", { name: "VAPID_*" });
      return name === "VAPID_PUBLIC_KEY" ? pair.publicKey : pair.privateKey;
    }
    const value = randomBytes(32).toString("base64");
    await tx.systemSecret.create({ data: { name, value } });
    log.info("secrets.generated", { name });
    return value;
  });
  cache.set(name, created);
  return created;
}

/** Ensures every secret exists (called by the seed so the first request does not pay for generation). */
export async function ensureSecrets(): Promise<void> {
  for (const name of SECRET_NAMES) await getSecret(name);
}
