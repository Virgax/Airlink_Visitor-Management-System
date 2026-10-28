/**
 * Railway `ops/backup` service (07:00 UTC): pg_dump (custom format, already compressed) → temp file →
 * PutObject in the S3-compatible bucket, keeps BACKUP_RETENTION_DAYS (30). Railway buckets use
 * virtual-hosted-style URLs (docs.railway.com/storage-buckets), so path style is off.
 * Every step logs a line and the whole run has a hard timeout so a stuck run never blocks the next one.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const retentionRaw = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);
const RETENTION_DAYS = Number.isFinite(retentionRaw) && retentionRaw >= 1 ? retentionRaw : 30;
const RUN_TIMEOUT_MS = Number(process.env.BACKUP_TIMEOUT_MS ?? 20 * 60_000);
const PREFIX = "backups/";

function log(msg: string): void {
  console.log(`[backup] ${new Date().toISOString()} ${msg}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function dumpToFile(databaseUrl: string, file: string): Promise<void> {
  log("pg_dump started");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", ["--no-owner", "--no-privileges", "--format=custom", "--compress=6", `--file=${file}`, databaseUrl], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PGCONNECT_TIMEOUT: "30" },
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}`))));
  });
  log(`pg_dump finished (${statSync(file).size} bytes)`);
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const endpoint = requireEnv("S3_ENDPOINT");
  const bucket = requireEnv("S3_BUCKET");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");

  const s3 = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "auto",
    forcePathStyle: process.env.S3_PATH_STYLE === "1",
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 10 * 60_000 },
    maxAttempts: 3,
  });

  const dir = await mkdtemp(join(tmpdir(), "visitas-backup-"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${PREFIX}visitas-${stamp}.dump`;
  const file = join(dir, "db.dump");
  try {
    await dumpToFile(databaseUrl, file);
    const size = statSync(file).size;
    log(`uploading ${key} (${size} bytes) to ${bucket} at ${endpoint}`);
    // A Buffer body can be retried by the SDK (a file stream cannot be rewound after a partial send).
    const body = await readFile(file);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: size, ContentType: "application/octet-stream" }));
    log(`uploaded ${key}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }));
  const old = (list.Contents ?? []).filter((o) => o.Key && o.Key !== key && o.LastModified && o.LastModified.getTime() < cutoff);
  if (old.length > 0) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.map((o) => ({ Key: o.Key! })) } }));
    log(`deleted ${old.length} backups older than ${RETENTION_DAYS} days`);
  }
  log(`done; ${(list.Contents ?? []).length - old.length} backups kept`);
}

const timer = setTimeout(() => {
  console.error(`[backup] timed out after ${RUN_TIMEOUT_MS} ms`);
  process.exit(2);
}, RUN_TIMEOUT_MS);

main()
  .then(() => {
    clearTimeout(timer);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[backup] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
