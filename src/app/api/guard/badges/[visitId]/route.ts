import { getLocale } from "next-intl/server";
import QRCode from "qrcode";
import { kioskRoute } from "@/lib/guard/route";
import { badgeJson, loadBadge } from "@/lib/server/badges";

export const dynamic = "force-dynamic";

/** Badge data of a visit of the kiosk's site, for the on-screen preview (assigns the badge number on first call). */
export async function GET(_req: Request, ctx: { params: Promise<{ visitId: string }> }): Promise<Response> {
  return kioskRoute(async ({ site }) => {
    const { visitId } = await ctx.params;
    const badge = await loadBadge(visitId, site.id, await getLocale());
    const qrSvg = await QRCode.toString(badge.data.qrPayload, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    return Response.json({ ok: true, badge: { ...badgeJson(badge), qrSvg } });
  });
}
