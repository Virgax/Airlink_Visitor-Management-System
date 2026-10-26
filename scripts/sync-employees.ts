/**
 * Directory sync from inside the app (`npm run sync:employees -- rows.json [--full] [--source spn|entra]`).
 * Reads rows from a JSON export and upserts `Employee` with the same parser the API uses. Reading SPN directly
 * from Railway needs `SPN_SQL_URL` + a SQL Server driver (not installed); until then `tools/sync-agent` pushes
 * the rows to /api/sync/employees from inside Airlink's network. Never writes to SPN.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import { parseEmployeeRows, upsertEmployees } from "../src/lib/sync/employees";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const full = args.includes("--full");
  const sourceArg = args[args.indexOf("--source") + 1];
  const source = args.includes("--source") && sourceArg === "entra" ? "entra" : "spn";
  if (!file) {
    console.error("Usage: npm run sync:employees -- rows.json [--full] [--source spn|entra]");
    if (process.env.SPN_SQL_URL) console.error("SPN_SQL_URL is set but direct SQL Server reads are not implemented; use tools/sync-agent.");
    process.exit(2);
  }
  const json = JSON.parse(await readFile(file, "utf8")) as unknown;
  const rows = Array.isArray(json) ? json : (json as { rows?: unknown[] })?.rows;
  if (!Array.isArray(rows)) throw new Error("Expected a JSON array or { rows: [...] }");
  const parsed = parseEmployeeRows(rows);
  const summary = await upsertEmployees(parsed.ok, { full, source });
  await db.auditLog.create({ data: { action: "employee.synced", targetType: "Employee", meta: { ...summary, rejected: parsed.rejected.length, received: rows.length, full, source, via: "script" } } });
  console.log(JSON.stringify({ ...summary, rejected: parsed.rejected.length }));
}

main()
  .catch((err) => {
    console.error("[sync:employees] failed", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
