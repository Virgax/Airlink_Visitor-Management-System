import type { NextRequest } from "next/server";
import { AuthError } from "@/lib/auth/guards";
import { getReportsTenantOrThrow } from "@/lib/auth/reports-access";
import { audit } from "@/lib/audit";
import { queryVisits, reportTimeZone, visitsToCsv } from "@/lib/server/reports";
import { parseVisitFilters } from "@/lib/server/reports-filters";
import { csvLabels, csvResponse, rawSiteId } from "../data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenant = await getReportsTenantOrThrow();
    const sp = Object.fromEntries(request.nextUrl.searchParams);
    const filters = parseVisitFilters(sp, { timeZone: reportTimeZone({ siteId: rawSiteId(sp) }, tenant) });
    const tz = reportTimeZone(filters, tenant);
    const [{ rows }, labels] = await Promise.all([queryVisits(filters, tenant, { all: true }), csvLabels()]);
    await audit({ action: "report.exported", siteId: filters.siteId ?? tenant.site?.id ?? null, actorId: tenant.user.id, meta: { report: "visits", rows: rows.length, from: filters.from, to: filters.to } });
    return csvResponse(visitsToCsv(rows, tz, labels.visits), `visitas_${filters.from}_${filters.to}.csv`);
  } catch (err) {
    if (err instanceof AuthError) return new Response(err.code, { status: err.code === "unauthenticated" ? 401 : 403 });
    throw err;
  }
}
