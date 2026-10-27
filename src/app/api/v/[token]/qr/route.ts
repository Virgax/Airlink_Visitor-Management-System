import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { qrPayloadFor } from "@/lib/server/passes";
import { TOKEN_RE } from "@/lib/passes/visitor";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

/**
 * Current QR payload for a pass. `?format=json` (default: payload + PNG data URL + refresh hint),
 * `?format=text` (payload only), `?format=svg`, `?format=png`. Only active passes inside their window get a code.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const ip = clientIp(request.headers) ?? "unknown";
  const [byIp, byToken] = await Promise.all([rateLimit(`qr:ip:${ip}`, 120, 60), rateLimit(`qr:token:${token}`, 60, 60)]);
  if (!byIp.ok || !byToken.ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });

  const pass = await db.pass.findUnique({ where: { token }, select: { id: true, siteId: true, kind: true, schedule: true, validFrom: true, validUntil: true, status: true } });
  if (!pass) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const now = new Date();
  if (pass.status !== "active" || pass.validUntil <= now) {
    return Response.json({ error: "not_active", status: pass.status }, { status: 409, headers: NO_STORE });
  }
  const qr = await qrPayloadFor(pass, now);
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format === "text") return new Response(qr.payload, { headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
  if (format === "svg") {
    const svg = await QRCode.toString(qr.payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return new Response(svg, { headers: { ...NO_STORE, "content-type": "image/svg+xml" } });
  }
  if (format === "png") {
    const png = await QRCode.toBuffer(qr.payload, { margin: 1, width: 288, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), { headers: { ...NO_STORE, "content-type": "image/png" } });
  }
  const dataUrl = await QRCode.toDataURL(qr.payload, { margin: 1, width: 288, errorCorrectionLevel: "M" });
  return Response.json({ payload: qr.payload, dataUrl, rotating: qr.rotating, refreshInSec: qr.refreshInSec, expiresAt: qr.expiresAt }, { headers: NO_STORE });
}
