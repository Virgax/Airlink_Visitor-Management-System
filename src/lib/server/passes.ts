import "server-only";
import { db } from "@/lib/db";

/**
 * Atomically consumes one use of a pass. Returns the updated row or null when no use was left
 * (`UPDATE … WHERE uses < maxUses RETURNING`). Single-use passes flip to `used`.
 */
export async function consumePassUse(passId: string, siteId: string): Promise<{ id: string; uses: number; maxUses: number; status: string } | null> {
  const rows = await db.$queryRaw<{ id: string; uses: number; maxUses: number; status: string }[]>`
    UPDATE "Pass"
       SET "uses" = "uses" + 1,
           "status" = CASE WHEN "uses" + 1 >= "maxUses" THEN 'used'::"PassStatus" ELSE "status" END,
           "updatedAt" = NOW()
     WHERE "id" = ${passId}
       AND "siteId" = ${siteId}
       AND "status" = 'active'::"PassStatus"
       AND "uses" < "maxUses"
 RETURNING "id", "uses", "maxUses", "status"::text AS "status"`;
  return rows[0] ?? null;
}

/** Cron: marks active passes whose window ended as expired. */
export async function expirePasses(now = new Date()): Promise<number> {
  const res = await db.pass.updateMany({
    where: { status: { in: ["active", "pending_approval"] }, validUntil: { lt: now } },
    data: { status: "expired" },
  });
  return res.count;
}
