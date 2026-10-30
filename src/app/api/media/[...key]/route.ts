import type { NextRequest } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getDevice } from "@/lib/auth/kiosk";
import { getSessionUser } from "@/lib/auth/session";
import { getFile, kindFromKey, mediaConfigured, siteIdFromKey } from "@/lib/media/putFile";
import { TOKEN_RE } from "@/lib/passes/visitor";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Serves private media. Access: a kiosk session of the key's site, an active membership that covers that site
 * (admin/security for everything; hosts only for form media), or — for form media only — the visitor of a pass of
 * that site identified by `?pass=<token>`. Shared form media lives under site `all`. Never cached by shared caches.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const siteId = siteIdFromKey(key);
  const kind = kindFromKey(key);
  if (!siteId || !kind) return new Response("Not found", { status: 404 });

  const user = await getSessionUser();
  const passToken = req.nextUrl.searchParams.get("pass");
  if (user) {
    if (!(await canReadSite(user, siteId, kind))) return new Response("Forbidden", { status: 403 });
  } else if ((kind === "forms" || kind === "nda") && passToken && TOKEN_RE.test(passToken)) {
    const pass = await db.pass.findUnique({ where: { token: passToken }, select: { siteId: true } });
    if (!pass || (siteId !== "all" && pass.siteId !== siteId)) return new Response("Forbidden", { status: 403 });
  } else {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!mediaConfigured()) return new Response("Media storage not configured", { status: 404 });
  const file = await getFile(key);
  if (!file) return new Response("Not found", { status: 404 });
  log.info("media.get", { key, userId: user?.id ?? null, viaPass: !user });
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
  };
  if (file.contentLength) headers["content-length"] = String(file.contentLength);
  return new Response(file.body, { headers });
}

async function canReadSite(user: { id: string; guardDeviceId: string | null }, siteId: string, kind: string): Promise<boolean> {
  if (user.guardDeviceId) {
    const device = await getDevice();
    return !!device && device.id === user.guardDeviceId && (siteId === "all" || device.siteId === siteId);
  }
  // Form media (instructions, documents shown on the forms) is readable by any member of the site; the rest only by staff.
  const roles: MembershipRole[] | undefined = kind === "forms" ? undefined : ["admin", "security"];
  const membership = await db.membership.findFirst({
    where: { userId: user.id, status: "active", ...(roles ? { role: { in: roles } } : {}), ...(siteId === "all" ? {} : { OR: [{ siteId: null }, { siteId }] }) },
    select: { id: true },
  });
  return !!membership;
}
