import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CANONICAL_HOST: z.string().optional(),
  // Signing keys and shared secrets: optional here; `getSecret()` in src/lib/secrets.ts falls back to
  // server-generated values stored in SystemSecret when a variable is not set.
  APP_ENCRYPTION_KEY: z.string().min(16).optional(),
  PASS_SIGNING_KEY: z.string().min(16).optional(),
  DOC_HASH_KEY: z.string().min(16).optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(8).optional(),
  SYNC_SECRET: z.string().optional(),
  PRINT_AGENT_SECRET: z.string().optional(),
  TEAMS_ACTION_SECRET: z.string().optional(),
  TEAMS_WEBHOOK_URL: z.string().url().optional(),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NOTIFY_FAKE: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated process.env, parsed lazily so `next build` does not need secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => process.env.NODE_ENV === "production";

/** Entra ID sign-in is available only when the app registration values are configured. */
export function entraConfigured(): boolean {
  return Boolean(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET);
}
