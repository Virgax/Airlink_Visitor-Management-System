/**
 * Railway Infrastructure as Code for project `airlink-visitas`.
 * Apply with the Railway CLI: `railway link` (project airlink-visitas) → `railway config plan` → `railway config apply`.
 * Secrets are never written here: they stay in Railway (`preserve()`); see .env.example for the list of names.
 */
import { bucket, defineRailway, github, group, postgres, preserve, project, service } from "railway/iac";

const REPO = "Virgax/Airlink_Visitor-Management-System";

export default defineRailway((ctx) => {
  const prod = ctx.environment === "production";
  const branch = prod ? "main" : "develop";

  const db = postgres("Postgres");
  const media = bucket("visitas-media", { region: "iad" });

  const bucketEnv = {
    S3_ENDPOINT: media.env.ENDPOINT,
    S3_BUCKET: media.env.BUCKET,
    S3_REGION: media.env.REGION,
    S3_ACCESS_KEY_ID: media.env.ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: media.env.SECRET_ACCESS_KEY,
  };

  const web = service("web", {
    source: github(REPO, { branch }),
    build: "npm run build",
    start: "npm run start:prod",
    healthcheck: "/api/health/ready",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: prod ? ["visitas.airlinkdr.com"] : [],
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      PORT: "3000",
      APP_URL: preserve(),
      CANONICAL_HOST: preserve(),
      APP_ENCRYPTION_KEY: preserve(),
      PASS_SIGNING_KEY: preserve(),
      DOC_HASH_KEY: preserve(),
      SESSION_SECRET: preserve(),
      CRON_SECRET: preserve(),
      SYNC_SECRET: preserve(),
      PRINT_AGENT_SECRET: preserve(),
      TEAMS_ACTION_SECRET: preserve(),
      TEAMS_WEBHOOK_URL: preserve(),
      ENTRA_TENANT_ID: preserve(),
      ENTRA_CLIENT_ID: preserve(),
      ENTRA_CLIENT_SECRET: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: "mailto:it@airlinkdr.com",
      SENTRY_DSN: preserve(),
      SEED_ADMIN_EMAIL: preserve(),
      SEED_ADMIN_PASSWORD: preserve(),
      ...bucketEnv,
    },
  });

  const cron = service("ops-cron", {
    source: github(REPO, { branch }),
    build: "npx prisma generate",
    start: "npm run cron:tick",
    env: {
      APP_URL: web.env.APP_URL,
      CRON_SECRET: web.env.CRON_SECRET,
    },
  });

  const backup = service("ops-backup", {
    source: github(REPO, { branch }),
    start: "npm run ops:backup",
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      BACKUP_RETENTION_DAYS: "30",
      ...bucketEnv,
    },
  });

  // Cron schedules (*/5 * * * * for ops-cron, 0 7 * * * for ops-backup) and the backup Dockerfile
  // (ops/backup.Dockerfile) are set on the services in Railway; the IaC SDK does not expose them yet.

  return project("airlink-visitas", {
    resources: [group("App", [web, db, media]), group("Ops", [cron, backup])],
  });
});
