import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSecret } from "@/lib/secrets";
import { safeEqual } from "@/lib/crypto/tokens";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { withAdvisoryLock } from "@/lib/jobs/withAdvisoryLock";
import { parseEmployeeRows, upsertEmployees } from "@/lib/sync/employees";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 20_000;

const payloadSchema = z.object({
  rows: z.array(z.unknown()).max(MAX_ROWS),
  /** The payload is the complete directory: employees of `source` not listed are marked inactive. */
  full: z.boolean().optional(),
  source: z.enum(["spn", "entra"]).optional(),
});

/**
 * Receives the employee directory from `tools/sync-agent` (or any job that can read SPN/Entra).
 * Auth: `x-signature` = hex HMAC-SHA256 of the raw body with `SYNC_SECRET` (optionally prefixed `sha256=`).
 * Body: `{ rows: object[], full?: boolean, source?: "spn" | "entra" }` or a bare array of rows.
 */
export async function POST(request: NextRequest) {
  const secret = await getSecret("SYNC_SECRET");
  if (!secret) {
    log.warn("sync.employees.disabled", { reason: "SYNC_SECRET not set" });
    return Response.json({ ok: false, error: "sync_disabled" }, { status: 503 });
  }

  const ip = clientIp(request.headers) ?? "unknown";
  const limit = await rateLimit(`sync:employees:ip:${ip}`, 20, 60);
  if (!limit.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  const header = (request.headers.get("x-signature") ?? "").trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (!header || !safeEqual(header, expected)) {
    log.warn("sync.employees.bad_signature", { ip });
    return Response.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsedPayload = payloadSchema.safeParse(Array.isArray(json) ? { rows: json } : json);
  if (!parsedPayload.success) return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  const { rows, full = false, source = "spn" } = parsedPayload.data;

  const parsed = parseEmployeeRows(rows);
  const run = await withAdvisoryLock("sync.employees", () => upsertEmployees(parsed.ok, { full, source }));
  if (!run.ran || !run.result) return Response.json({ ok: false, error: "sync_in_progress" }, { status: 409 });

  const summary = { ...run.result, rejected: parsed.rejected.length, received: rows.length, full, source };
  await audit({ action: "employee.synced", targetType: "Employee", meta: summary });
  return Response.json({
    ok: true,
    ...summary,
    // Reasons only (no row contents) so the agent can log what to fix without echoing personal data.
    rejectedReasons: parsed.rejected.map((r) => r.reason),
  });
}
