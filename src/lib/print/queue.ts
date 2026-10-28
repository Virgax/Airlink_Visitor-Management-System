import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto/tokens";
import { deleteObject, getFileBytes, listObjects, mediaConfigured, putObject } from "@/lib/media/putFile";

/**
 * Print queue without a table: each job is one object in the private bucket under
 * `s/<siteId>/print/<gateId>/<jobId>.zpl`. The kiosk enqueues, `tools/print-agent` lists, pulls and deletes.
 * Job ids are `<created ms>-<visitId>` so a listing sorts oldest first even without LastModified.
 */

export const JOB_ID = /^[0-9]{10,16}-[A-Za-z0-9_-]{1,64}$/;

export function printPrefix(siteId: string, gateId: string): string {
  return `s/${siteId}/print/${gateId}/`;
}

export function printQueueConfigured(): boolean {
  return mediaConfigured();
}

export async function enqueuePrintJob(input: { siteId: string; gateId: string; visitId: string; zpl: string }): Promise<string> {
  const jobId = `${Date.now()}-${input.visitId}`;
  await putObject(`${printPrefix(input.siteId, input.gateId)}${jobId}.zpl`, input.zpl, "text/plain; charset=utf-8");
  return jobId;
}

export type PrintJob = { id: string; visitId: string; createdAt: string; zpl: string };

/** Pending jobs of a gate, oldest first (at most `max`), with their ZPL. */
export async function listPrintJobs(siteId: string, gateId: string, max = 10): Promise<PrintJob[]> {
  const prefix = printPrefix(siteId, gateId);
  const objects = await listObjects(prefix, max);
  const jobs: PrintJob[] = [];
  for (const o of objects) {
    const id = o.key.slice(prefix.length).replace(/\.zpl$/, "");
    if (!JOB_ID.test(id)) continue;
    const bytes = await getFileBytes(o.key);
    if (!bytes) continue;
    const [ms, visitId] = id.split("-", 2) as [string, string];
    jobs.push({ id, visitId, createdAt: new Date(Number(ms)).toISOString(), zpl: new TextDecoder().decode(bytes) });
  }
  return jobs.sort((a, b) => a.id.localeCompare(b.id));
}

export async function deletePrintJob(siteId: string, gateId: string, jobId: string): Promise<boolean> {
  if (!JOB_ID.test(jobId)) return false;
  await deleteObject(`${printPrefix(siteId, gateId)}${jobId}.zpl`);
  return true;
}

export const AGENT_MAX_SKEW_SEC = 300;

/** Canonical string the agent signs: method, path with query, unix timestamp (seconds), newline-separated. */
export function agentSigningString(method: string, pathWithQuery: string, timestamp: string): string {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}`;
}

export function agentSignature(secret: string, method: string, pathWithQuery: string, timestamp: string): string {
  return createHmac("sha256", secret).update(agentSigningString(method, pathWithQuery, timestamp)).digest("hex");
}

/**
 * Verifies `x-timestamp` + `x-signature` (hex HMAC-SHA256 with PRINT_AGENT_SECRET, optionally `sha256=` prefixed).
 * Pure given the secret so it is unit-testable; the route passes the request's method, path+query and headers.
 */
export function verifyAgentRequest(input: { secret: string; method: string; pathWithQuery: string; timestamp: string | null; signature: string | null; now?: number }): { ok: true } | { ok: false; reason: "missing" | "skew" | "bad_signature" } {
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing" };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || Math.abs((input.now ?? Date.now()) / 1000 - ts) > AGENT_MAX_SKEW_SEC) return { ok: false, reason: "skew" };
  const expected = agentSignature(input.secret, input.method, input.pathWithQuery, input.timestamp);
  const given = input.signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!safeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
