/**
 * Railway `ops/backup` service (07:00 UTC): pg_dump → gzip → S3-compatible bucket, keeps 30 days.
 * Requires DATABASE_URL and S3_* variables. Uses pg_dump from the image (Railpack installs postgresql-client
 * when `pg_dump` is listed in railpack.json / nixpacks aptPkgs).
 */
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { PassThrough } from "node:stream";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

async function main(): Promise<void> {
  const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  const required = ["DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  for (const k of required) {
    if (!process.env[k]) throw new Error(`${k} is required`);
  }

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  const bucket = process.env.S3_BUCKET!;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `backups/visitas-${stamp}.sql.gz`;

  const dump = spawn("pg_dump", ["--no-owner", "--no-privileges", process.env.DATABASE_URL!], { stdio: ["ignore", "pipe", "inherit"] });
  const body = new PassThrough();
  dump.stdout.pipe(createGzip()).pipe(body);

  const upload = new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: body, ContentType: "application/gzip" } });
  await upload.done();
  const code = await new Promise<number>((resolve) => dump.on("close", resolve));
  if (code !== 0) throw new Error(`pg_dump exited with ${code}`);
  console.log(`uploaded ${key}`);

  // Retention
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/" }));
  const old = (list.Contents ?? []).filter((o) => o.Key && o.LastModified && o.LastModified.getTime() < cutoff);
  if (old.length > 0) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: old.map((o) => ({ Key: o.Key! })) } }));
    console.log(`deleted ${old.length} old backups`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
