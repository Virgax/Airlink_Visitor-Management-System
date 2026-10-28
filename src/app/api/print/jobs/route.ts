import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { deletePrintJob, listPrintJobs, printQueueConfigured, verifyAgentRequest } from "@/lib/print/queue";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Queue endpoint for `tools/print-agent` (no session: HMAC with PRINT_AGENT_SECRET).
 *   GET    /api/print/jobs?gate=<gateId>              → pending jobs of that gate, with their ZPL
 *   DELETE /api/print/jobs?gate=<gateId>&job=<jobId>  → acknowledges a printed job
 * Headers: `x-timestamp` (unix seconds) and `x-signature` = hex HMAC-SHA256 of `METHOD\n/path?query\ntimestamp`.
 */
async function authorize(request: NextRequest): Promise<{ ok: true; gate: { id: string; siteId: string } } | { ok: false; res: Response }> {
  const ip = clientIp(request.headers) ?? "unknown";
  const limit = await rateLimit(`print:jobs:ip:${ip}`, 120, 60);
  if (!limit.ok) return { ok: false, res: Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } }) };
  const check = verifyAgentRequest({
    secret: await getSecret("PRINT_AGENT_SECRET"),
    method: request.method,
    pathWithQuery: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    timestamp: request.headers.get("x-timestamp"),
    signature: request.headers.get("x-signature"),
  });
  if (!check.ok) {
    log.warn("print.jobs.unauthorized", { reason: check.reason, ip });
    return { ok: false, res: Response.json({ ok: false, error: check.reason === "skew" ? "clock_skew" : "bad_signature" }, { status: 401 }) };
  }
  const gateId = request.nextUrl.searchParams.get("gate") ?? "";
  const gate = gateId ? await db.gate.findFirst({ where: { id: gateId, active: true }, select: { id: true, siteId: true } }) : null;
  if (!gate) return { ok: false, res: Response.json({ ok: false, error: "unknown_gate" }, { status: 404 }) };
  if (!printQueueConfigured()) return { ok: false, res: Response.json({ ok: false, error: "print_not_configured" }, { status: 503 }) };
  return { ok: true, gate };
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return auth.res;
  const jobs = await listPrintJobs(auth.gate.siteId, auth.gate.id);
  return Response.json({ ok: true, jobs, at: new Date().toISOString() });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth.ok) return auth.res;
  const jobId = request.nextUrl.searchParams.get("job") ?? "";
  const deleted = await deletePrintJob(auth.gate.siteId, auth.gate.id, jobId);
  if (!deleted) return Response.json({ ok: false, error: "invalid_job" }, { status: 400 });
  log.info("print.job_done", { jobId, gateId: auth.gate.id });
  return Response.json({ ok: true });
}
