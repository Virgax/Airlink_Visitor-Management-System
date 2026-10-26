import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

function lockId(name: string): bigint {
  // 63-bit key derived from the job name
  const h = createHash("sha256").update(name).digest();
  return h.readBigInt64BE(0) & 0x7fffffffffffffffn;
}

/**
 * Runs `fn` only if this replica obtains the Postgres advisory lock for `name`.
 * Returns `{ ran: false }` when another replica holds it. Lock is session-scoped on a dedicated connection.
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<{ ran: boolean; result?: T }> {
  const id = lockId(name);
  // Use an interactive transaction so the lock lives on one connection for the whole job.
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${id}) AS locked`;
      if (!rows[0]?.locked) {
        log.info("job.skipped", { job: name, reason: "locked" });
        return { ran: false };
      }
      const started = Date.now();
      const result = await fn();
      log.info("job.done", { job: name, ms: Date.now() - started });
      return { ran: true, result };
    },
    { timeout: 5 * 60 * 1000, maxWait: 10_000 },
  );
}
