import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { canEditFromLink, TOKEN_RE } from "@/lib/passes/visitor";
import { sniffImage } from "@/lib/media/putFile";
import { MAX_PASS_PHOTO_BYTES } from "@/lib/server/passPhoto";
import { readMrzFromImage } from "@/lib/server/mrz";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "cache-control": "no-store" };

/**
 * Reads the MRZ of the document photo a visitor just took on their link (multipart `file`) and returns the fields
 * so the browser can pre-fill the form. Nothing is stored here: the photo and the data are saved when the visitor
 * submits the registration form. Only an open link can ask, and OCR is expensive, so the limits are tight.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const ip = clientIp(request.headers) ?? "unknown";
  const [byIp, byToken] = await Promise.all([rateLimit(`mrz:ip:${ip}`, 20, 600), rateLimit(`mrz:token:${token}`, 12, 600)]);
  if (!byIp.ok || !byToken.ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  const pass = await db.pass.findUnique({ where: { token }, select: { id: true, status: true, validUntil: true, selfRegistration: true, registeredAt: true } });
  if (!pass) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  if (!canEditFromLink(pass)) return Response.json({ error: "closed" }, { status: 409, headers: NO_STORE });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File && f.size > 0 ? f : null;
  } catch {
    return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }
  if (!file) return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  if (file.size > MAX_PASS_PHOTO_BYTES) return Response.json({ error: "too_big" }, { status: 413, headers: NO_STORE });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(bytes)) return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });

  try {
    const identity = await readMrzFromImage(bytes);
    if (!identity) return Response.json({ found: false }, { headers: NO_STORE });
    const { lines: _lines, ...fields } = identity;
    return Response.json({ found: true, identity: fields }, { headers: NO_STORE });
  } catch (err) {
    log.error("mrz.failed", { passId: pass.id, err: String(err) });
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
