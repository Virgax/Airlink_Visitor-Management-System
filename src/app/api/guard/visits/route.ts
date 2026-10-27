import type { NextRequest } from "next/server";
import { z } from "zod";
import { kioskRoute } from "@/lib/guard/route";
import { checkoutVisit, decideVisit, enterVisit, listGateVisits, listOpenVisits, visitJson } from "@/lib/server/visits";

export const dynamic = "force-dynamic";

/** Visits of the kiosk's site: `?status=pending` (waiting at the gate) or `?status=inside` (on site). Polled by the kiosk. */
export async function GET(request: NextRequest): Promise<Response> {
  return kioskRoute(async ({ site }) => {
    const status = request.nextUrl.searchParams.get("status") ?? "pending";
    const visits = status === "inside" ? await listOpenVisits(site.id) : await listGateVisits(site.id);
    return Response.json({ ok: true, visits: visits.map(visitJson), at: new Date().toISOString() });
  });
}

const actionSchema = z.object({
  visitId: z.string().min(1),
  action: z.enum(["approve_in_person", "deny", "enter", "checkout"]),
});

/** Guard actions on a visit of the kiosk's site. */
export async function POST(request: NextRequest): Promise<Response> {
  return kioskRoute(async ({ user, site }) => {
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    const { visitId, action } = parsed.data;
    const visit =
      action === "approve_in_person" ? await decideVisit(visitId, "approved", user.id, { siteId: site.id, enter: true })
      : action === "deny" ? await decideVisit(visitId, "denied", user.id, { siteId: site.id })
      : action === "enter" ? await enterVisit(visitId, site.id, user.id)
      : await checkoutVisit(visitId, site.id, user.id);
    return Response.json({ ok: true, visit: visitJson(visit) });
  });
}
