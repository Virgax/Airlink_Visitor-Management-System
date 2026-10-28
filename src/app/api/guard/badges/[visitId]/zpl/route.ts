import type { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";
import { kioskRoute } from "@/lib/guard/route";
import { auditBadgePrint, renderVisitBadge } from "@/lib/server/badges";

export const dynamic = "force-dynamic";

/**
 * ZPL of the badge (text/plain) for a visit of the kiosk's site. The fetch *is* the print when the kiosk sends it
 * to Zebra Browser Print or downloads it, so it is audited: `?reprint=1` → `badge.reprinted`, else `badge.printed`.
 * `?via=browser|download` records the channel; `?audit=0` fetches without auditing (e.g. a preview).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ visitId: string }> }): Promise<Response> {
  return kioskRoute(async ({ user, site }) => {
    const { visitId } = await ctx.params;
    const { zpl, badge } = await renderVisitBadge(visitId, site.id, await getLocale());
    const q = request.nextUrl.searchParams;
    if (q.get("audit") !== "0") {
      const via = q.get("via") === "browser" ? "browser" : q.get("via") === "download" ? "download" : "zpl";
      await auditBadgePrint({ visit: badge.visit, actorId: user.id, reprint: q.get("reprint") === "1", via });
    }
    return new Response(zpl, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="badge-${badge.visit.badgeNo ?? visitId}.zpl"`,
      },
    });
  });
}
