import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { selfVisitJson, selfVisitSelect, verifyVisitKey } from "@/lib/server/self-signin";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

/** Status of a self sign-in visit for its visitor (`?k=` signed key from the redirect). Polled every 4 s. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const k = request.nextUrl.searchParams.get("k") ?? undefined;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(visitId)) return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const ip = clientIp(request.headers) ?? "unknown";
  const limit = await rateLimit(`self-poll:ip:${ip}`, 120, 60);
  if (!limit.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: NO_STORE });
  if (!(await verifyVisitKey(k, visitId))) return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const visit = await db.visit.findUnique({ where: { id: visitId }, select: selfVisitSelect });
  if (!visit) return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  return Response.json({ ok: true, visit: selfVisitJson(visit), at: new Date().toISOString() }, { headers: NO_STORE });
}
