import type { NextRequest } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { kioskRoute } from "@/lib/guard/route";
import { readPrinter } from "@/lib/badges/config";
import { enqueuePrintJob, printQueueConfigured } from "@/lib/print/queue";
import { auditBadgePrint, renderVisitBadge } from "@/lib/server/badges";
import { rateLimit } from "@/lib/rateLimit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ visitId: z.string().min(1).max(64), reprint: z.boolean().optional() });

/** Kiosk → queue: renders the badge of a visit of this site and leaves it for the print agent of this gate. */
export async function POST(request: NextRequest): Promise<Response> {
  return kioskRoute(async ({ user, device, site, gate }) => {
    const limit = await rateLimit(`print:enqueue:${device.id}`, 60, 60);
    if (!limit.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
    const printer = readPrinter(gate.settings);
    if (printer?.kind !== "agent") return Response.json({ ok: false, error: "no_agent_printer" }, { status: 409 });
    if (!printQueueConfigured()) return Response.json({ ok: false, error: "print_not_configured" }, { status: 503 });

    const { zpl, badge } = await renderVisitBadge(parsed.data.visitId, site.id, await getLocale());
    const jobId = await enqueuePrintJob({ siteId: site.id, gateId: gate.id, visitId: badge.visit.id, zpl });
    await auditBadgePrint({ visit: badge.visit, actorId: user.id, reprint: parsed.data.reprint === true, via: "agent" });
    log.info("print.enqueued", { jobId, visitId: badge.visit.id, gateId: gate.id });
    return Response.json({ ok: true, jobId, badgeNo: badge.visit.badgeNo });
  });
}
