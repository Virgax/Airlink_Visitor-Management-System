/** Railway cron service: POST $APP_URL/api/cron/tick with CRON_SECRET (variable, or the server-generated one in Postgres). */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL is required");
  let secret = process.env.CRON_SECRET;
  if (!secret) {
    const db = new PrismaClient();
    try {
      const row = await db.systemSecret.findUnique({ where: { name: "CRON_SECRET" } });
      secret = row?.value;
    } finally {
      await db.$disconnect();
    }
  }
  if (!secret) throw new Error("CRON_SECRET is not set and has not been generated yet (the web service creates it on first boot)");
  const res = await fetch(`${appUrl}/api/cron/tick`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
