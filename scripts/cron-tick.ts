/** Railway cron service: POST $APP_URL/api/cron/tick with CRON_SECRET. */
export {};
const appUrl = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
if (!appUrl || !secret) {
  console.error("APP_URL and CRON_SECRET are required");
  process.exit(1);
}
const res = await fetch(`${appUrl}/api/cron/tick`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
