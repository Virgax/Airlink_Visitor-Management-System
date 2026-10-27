/** Railway cron service: POST $APP_URL/api/cron/tick with CRON_SECRET (variable, or the server-generated one in Postgres). */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const appUrl = process.env.APP_URL;
if (!appUrl) {
  console.error("APP_URL is required");
  process.exit(1);
}
let secret = process.env.CRON_SECRET;
if (!secret) {
  const db = new PrismaClient();
  const row = await db.systemSecret.findUnique({ where: { name: "CRON_SECRET" } });
  await db.$disconnect();
  secret = row?.value;
}
if (!secret) {
  console.error("CRON_SECRET is not set and has not been generated yet (the web service creates it on first boot)");
  process.exit(1);
}
const res = await fetch(`${appUrl}/api/cron/tick`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
