import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { kioskRoute } from "@/lib/guard/route";
import { badgePhotoKey, mediaConfigured, putFile, sniffImage } from "@/lib/media/putFile";
import { rateLimit } from "@/lib/rateLimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;

/**
 * Stores the badge photo the kiosk captured (a 1-bit PNG, 160 × 200) in the private bucket under
 * `s/<siteId>/visits/<visitId>/badge.png` and records the key on the visit. Without a bucket the kiosk prints
 * without a photo: this answers 503 `media_not_configured` and the client carries on.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ visitId: string }> }): Promise<Response> {
  return kioskRoute(async ({ device, site }) => {
    const { visitId } = await ctx.params;
    const limit = await rateLimit(`badge:photo:${device.id}`, 60, 60);
    if (!limit.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
    if (!mediaConfigured()) return Response.json({ ok: false, error: "media_not_configured" }, { status: 503 });

    const visit = await db.visit.findFirst({ where: { id: visitId, siteId: site.id }, select: { id: true, status: true } });
    if (!visit) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    if (visit.status !== "inside" && visit.status !== "at_dock") return Response.json({ ok: false, error: "bad_state" }, { status: 409 });

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
    if (sniffImage(bytes) !== "image/png") return Response.json({ ok: false, error: "invalid_image" }, { status: 400 });

    const key = badgePhotoKey(site.id, visit.id);
    await putFile(key, bytes, "image/png");
    await db.visit.update({ where: { id: visit.id }, data: { badgePhotoKey: key } });
    log.info("badge.photo_stored", { visitId: visit.id, deviceId: device.id });
    return Response.json({ ok: true, key });
  });
}
