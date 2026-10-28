import { db } from "@/lib/db";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { kioskRoute } from "@/lib/guard/route";
import { policyFlags } from "@/lib/guard/decide";
import type { BadgeInfo } from "@/lib/guard/types";
import { assignBadgeNo } from "@/lib/server/badges";
import { checkoutVisit, decideVisit, enterVisit, listGateVisits, listOpenVisits, visitJson, type VisitSummary } from "@/lib/server/visits";

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

/** "Enter" on a still-pending unannounced visit is an in-person approval, so it goes through decideVisit. */
async function enterOrApprove(visitId: string, siteId: string, userId: string) {
  const current = await db.visit.findFirst({ where: { id: visitId, siteId }, select: { status: true } });
  if (current?.status === "pending") return decideVisit(visitId, "approved", userId, { siteId, enter: true, via: "kiosk" });
  return enterVisit(visitId, siteId, userId);
}

/** Guard actions on a visit of the kiosk's site. */
export async function POST(request: NextRequest): Promise<Response> {
  return kioskRoute(async ({ user, site }) => {
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    const { visitId, action } = parsed.data;
    const visit =
      action === "approve_in_person" ? await decideVisit(visitId, "approved", user.id, { siteId: site.id, enter: true })
      : action === "deny" ? await decideVisit(visitId, "denied", user.id, { siteId: site.id })
      : action === "enter" ? await enterOrApprove(visitId, site.id, user.id)
      : await checkoutVisit(visitId, site.id, user.id);
    if (!visit) return Response.json({ ok: false, error: "bad_state" }, { status: 409 });
    const badge = action === "checkout" || action === "deny" ? null : await badgeStep(visit);
    return Response.json({ ok: true, visit: visitJson({ ...visit, badgeNo: badge?.badgeNo ?? visit.badgeNo }), ...(badge ? { badge } : {}) });
  });
}

/** After an in-person approval or a manual entry: number the badge when the policy prints one for this kind. */
async function badgeStep(visit: VisitSummary): Promise<BadgeInfo | null> {
  if (visit.status !== "inside" && visit.status !== "at_dock") return null;
  const policy = policyFlags(visit.kind, await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId: visit.siteId, kind: visit.kind } } }));
  if (!policy.badge) return null;
  return { visitId: visit.id, badgeNo: await assignBadgeNo(visit.id), autoPrint: policy.autoPrintBadge };
}
