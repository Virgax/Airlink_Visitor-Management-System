#!/usr/bin/env node
/**
 * Airlink Visitas — employee directory sync agent.
 *
 * Runs on a machine that can reach SPN (SQL Server) and POSTs the rows, signed with SYNC_SECRET, to
 * `${VISITAS_URL}/api/sync/employees`. Node 20+, no dependencies.
 *
 *   node index.mjs --file rows.json [--full] [--source spn|entra] [--dry-run]
 *   SPN_SQL_URL=... node index.mjs --full            (SQL Server read — TODO, see readFromSpn)
 *
 * Environment: VISITAS_URL (e.g. https://visitas.airlinkdr.com), SYNC_SECRET (same value as the Railway variable).
 * The body is `{ rows, full, source }`; the header `x-signature` is the hex HMAC-SHA256 of the exact body bytes.
 */
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

function parseArgs(argv) {
  const args = { file: null, full: false, source: "spn", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i] ?? null;
    else if (a === "--full") args.full = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--source") args.source = argv[++i] ?? "spn";
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node index.mjs --file rows.json [--full] [--source spn|entra] [--dry-run]");
      process.exit(0);
    }
  }
  return args;
}

async function readFromFile(path) {
  const text = await readFile(path, "utf8");
  const json = JSON.parse(text);
  const rows = Array.isArray(json) ? json : json?.rows;
  if (!Array.isArray(rows)) throw new Error(`${path}: expected a JSON array or { rows: [...] }`);
  return rows;
}

/**
 * TODO (Jaime): read-only query against SPN. Requires a SQL Server driver (`mssql` or `tedious`) on the file
 * server and SPN_SQL_URL (mssql://user:pass@host/spn). Nothing here may write to SPN. The query shape agreed in
 * docs/PLAN.md §6 ("nombre, departamento, extensión, foto" + correo and estado):
 *
 *   SELECT codigo, nombre, departamento, extension, correo, telefono, activo, foto
 *   FROM spn.dbo.empleados
 *   WHERE activo IS NULL OR activo IN (1, 'S', 'A')   -- or drop the filter and send --full so leavers are deactivated
 *
 * Column names are matched loosely by the server (`parseEmployeeRows` tolerates nombre/name, codigo/id, correo/email…),
 * so `SELECT *` also works as long as the columns above exist. Send `foto` as base64 (or null); empty images are ignored.
 */
async function readFromSpn(_sqlUrl) {
  throw new Error("SPN read not implemented yet: pass --file rows.json, or implement readFromSpn with mssql/tedious (read-only).");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (process.env.VISITAS_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.SYNC_SECRET ?? "";
  if (!args.dryRun && (!baseUrl || !secret)) {
    console.error("Set VISITAS_URL and SYNC_SECRET (or use --dry-run).");
    process.exit(2);
  }

  let rows;
  if (args.file) rows = await readFromFile(args.file);
  else if (process.env.SPN_SQL_URL) rows = await readFromSpn(process.env.SPN_SQL_URL);
  else {
    console.error("Nothing to sync: pass --file rows.json or set SPN_SQL_URL.");
    process.exit(2);
  }

  const body = JSON.stringify({ rows, full: args.full, source: args.source });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  console.log(`[sync-agent] ${rows.length} rows, full=${args.full}, source=${args.source}`);
  if (args.dryRun) {
    console.log(`[sync-agent] dry run; body ${body.length} bytes, x-signature ${signature.slice(0, 12)}…`);
    return;
  }

  const res = await fetch(`${baseUrl}/api/sync/employees`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let result = null;
  try {
    result = JSON.parse(text);
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    console.error(`[sync-agent] failed: HTTP ${res.status} ${result?.error ?? text.slice(0, 200)}`);
    process.exit(1);
  }
  const { created, updated, deactivated, skipped, rejected } = result ?? {};
  console.log(`[sync-agent] ok: created=${created} updated=${updated} deactivated=${deactivated} skipped=${skipped} rejected=${rejected}`);
  if (Array.isArray(result?.rejectedReasons) && result.rejectedReasons.length) {
    const counts = {};
    for (const r of result.rejectedReasons) counts[r] = (counts[r] ?? 0) + 1;
    console.warn("[sync-agent] rejected rows by reason:", counts);
  }
}

main().catch((err) => {
  console.error("[sync-agent] error:", err?.message ?? err);
  process.exit(1);
});
