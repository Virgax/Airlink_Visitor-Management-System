#!/usr/bin/env node
/**
 * Airlink Visitas — badge print agent.
 *
 * Runs on the reception PC next to the Zebra ZP450. Every few seconds it asks the server for pending badge jobs
 * of its gate, sends the raw ZPL to the printer and acknowledges each job. Node 20+, no dependencies.
 *
 *   node index.mjs [--config print-agent.json] [--once] [--dry-run] [--test]
 *
 * Config file (JSON, next to this script by default):
 *   {
 *     "url": "https://visitas.airlinkdr.com",
 *     "gateId": "<Gate.id from /admin/sites/<site>>",
 *     "secret": "<PRINT_AGENT_SECRET, same value as on Railway>",
 *     "printer": { "share": "ZP450" }            // Windows: shared printer name (\\localhost\ZP450), RAW datatype
 *               | { "host": "192.168.1.50", "port": 9100 }   // network print server / Linux / macOS
 *               | { "device": "/dev/usb/lp0" }   // Linux raw USB device
 *     "intervalMs": 3000
 *   }
 * Environment variables override the file: VISITAS_URL, PRINT_GATE_ID, PRINT_AGENT_SECRET, PRINT_SHARE, PRINT_HOST,
 * PRINT_PORT, PRINT_DEVICE, PRINT_INTERVAL_MS.
 *
 * Auth: `x-timestamp` (unix seconds) and `x-signature` = hex HMAC-SHA256(secret, "METHOD\n/path?query\ntimestamp").
 */
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { config: join(here, "print-agent.json"), once: false, dryRun: false, test: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i] ?? args.config;
    else if (a === "--once") args.once = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--test") args.test = true;
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node index.mjs [--config print-agent.json] [--once] [--dry-run] [--test]");
      process.exit(0);
    }
  }
  return args;
}

async function loadConfig(path) {
  let file = {};
  try {
    file = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const env = process.env;
  const printer = { ...(file.printer ?? {}) };
  if (env.PRINT_SHARE) printer.share = env.PRINT_SHARE;
  if (env.PRINT_HOST) printer.host = env.PRINT_HOST;
  if (env.PRINT_PORT) printer.port = Number(env.PRINT_PORT);
  if (env.PRINT_DEVICE) printer.device = env.PRINT_DEVICE;
  return {
    url: (env.VISITAS_URL ?? file.url ?? "").replace(/\/+$/, ""),
    gateId: env.PRINT_GATE_ID ?? file.gateId ?? "",
    secret: env.PRINT_AGENT_SECRET ?? file.secret ?? "",
    intervalMs: Number(env.PRINT_INTERVAL_MS ?? file.intervalMs ?? 3000),
    printer,
  };
}

function log(msg, extra) {
  console.log(`[print-agent ${new Date().toISOString()}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
}

function sign(secret, method, pathWithQuery, timestamp) {
  return createHmac("sha256", secret).update(`${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}`).digest("hex");
}

async function api(cfg, method, pathWithQuery) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${cfg.url}${pathWithQuery}`, {
    method,
    headers: { "x-timestamp": timestamp, "x-signature": sign(cfg.secret, method, pathWithQuery, timestamp), accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${pathWithQuery} → ${res.status} ${body?.error ?? ""}`.trim());
  return body;
}

/** Windows: `copy /b <file> \\localhost\<share>` sends the bytes untouched to a printer shared with RAW datatype. */
function printViaShare(share, zpl) {
  return new Promise(async (resolve, reject) => {
    const dir = await mkdtemp(join(tmpdir(), "visitas-badge-"));
    const file = join(dir, "badge.zpl");
    await writeFile(file, zpl, "utf8");
    const target = share.includes("\\") ? share : `\\\\localhost\\${share}`;
    execFile("cmd.exe", ["/c", "copy", "/b", file, target], { windowsHide: true }, (err, stdout, stderr) => {
      rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (err) reject(new Error(`copy /b failed: ${stderr || stdout || err.message}`));
      else resolve();
    });
  });
}

/** Raw TCP 9100 (print server, Ethernet Zebra, or a socat bridge). */
function printViaTcp(host, port, zpl) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port }, () => {
      socket.end(zpl, "utf8");
    });
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error("timeout"));
    });
    socket.on("error", reject);
    socket.on("close", (hadError) => (hadError ? undefined : resolve()));
  });
}

/** Linux raw USB printer class device (`/dev/usb/lp0`). */
async function printViaDevice(device, zpl) {
  await writeFile(device, zpl, "utf8");
}

async function printZpl(cfg, zpl, dryRun) {
  if (dryRun) {
    log("dry run: would print", { bytes: Buffer.byteLength(zpl), head: zpl.slice(0, 40).replace(/\n/g, " ") });
    return;
  }
  const p = cfg.printer;
  if (p.host) return printViaTcp(p.host, Number(p.port ?? 9100), zpl);
  if (p.device) return printViaDevice(p.device, zpl);
  if (p.share) {
    if (process.platform !== "win32") throw new Error("printer.share only works on Windows; use printer.host or printer.device");
    return printViaShare(p.share, zpl);
  }
  throw new Error("No printer configured: set printer.share (Windows), printer.host (TCP 9100) or printer.device (Linux).");
}

const TEST_LABEL = "^XA^CI28^MNY^PW812^LL406^FO16,16^A0N,40,40^FDAirlink Visitas · prueba de impresión^FS^FO16,80^A0N,28,28^FDSi lees esto, el agente y la impresora funcionan.^FS^FO598,196^BQN,2,6^FDMA,visitas:test^FS^PQ1^XZ";

async function tick(cfg, args) {
  const path = `/api/print/jobs?gate=${encodeURIComponent(cfg.gateId)}`;
  const body = await api(cfg, "GET", path);
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  for (const job of jobs) {
    try {
      await printZpl(cfg, job.zpl, args.dryRun);
      await api(cfg, "DELETE", `${path}&job=${encodeURIComponent(job.id)}`);
      log("printed", { job: job.id, visit: job.visitId });
    } catch (err) {
      log("print failed; will retry", { job: job.id, err: String(err?.message ?? err) });
      break; // keep order: do not skip to the next job while the printer is down
    }
  }
  return jobs.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config);
  if (args.test) {
    await printZpl(cfg, TEST_LABEL, args.dryRun);
    log("test label sent");
    return;
  }
  if (!cfg.url || !cfg.gateId || !cfg.secret) {
    console.error("Missing url, gateId or secret (config file or VISITAS_URL / PRINT_GATE_ID / PRINT_AGENT_SECRET).");
    process.exit(2);
  }
  log("started", { url: cfg.url, gateId: cfg.gateId, printer: cfg.printer, intervalMs: cfg.intervalMs });
  let backoff = cfg.intervalMs;
  for (;;) {
    try {
      await tick(cfg, args);
      backoff = cfg.intervalMs;
    } catch (err) {
      log("poll failed", { err: String(err?.message ?? err) });
      backoff = Math.min(backoff * 2, 60_000);
    }
    if (args.once) return;
    await new Promise((r) => setTimeout(r, backoff));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
