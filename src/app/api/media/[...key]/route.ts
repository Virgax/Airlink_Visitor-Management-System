import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getDevice } from "@/lib/auth/kiosk";
import { getSessionUser } from "@/lib/auth/session";
import { getFile, mediaConfigured, siteIdFromKey } from "@/lib/media/putFile";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Serves private media. Access: a kiosk session of the key's site, or an active admin/security membership that covers
 * that site. Never cached by shared caches.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const siteId = siteIdFromKey(key);
  if (!siteId) return new Response("Not found", { status: 404 });

  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await canReadSite(user, siteId))) return new Response("Forbidden", { status: 403 });

  if (!mediaConfigured()) return new Response("Media storage not configured", { status: 404 });
  const file = await getFile(key);
  if (!file) return new Response("Not found", { status: 404 });
  log.info("media.get", { key, userId: user.id });
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
  };
  if (file.contentLength) headers["content-length"] = String(file.contentLength);
  return new Response(file.body, { headers });
}

async function canReadSite(user: { id: string; guardDeviceId: string | null }, siteId: string): Promise<boolean> {
  if (user.guardDeviceId) {
    const device = await getDevice();
    return !!device && device.id === user.guardDeviceId && device.siteId === siteId;
  }
  const membership = await db.membership.findFirst({
    where: { userId: user.id, status: "active", role: { in: ["admin", "security"] }, OR: [{ siteId: null }, { siteId }] },
    select: { id: true },
  });
  return !!membership;
}
