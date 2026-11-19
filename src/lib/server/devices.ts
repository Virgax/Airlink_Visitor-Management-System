import "server-only";
import { db } from "@/lib/db";
import { devicesSatisfied, normalizeDeviceId, readDevices, readDevicesNone, type Device } from "@/lib/forms/schema";
import { loadPolicyAndForm } from "@/lib/server/forms";
import { readSiteSettings } from "@/lib/server/sites";
import { loadPass, type LoadedPass } from "@/lib/server/scan";
import { visitSummarySelect, type VisitSummary } from "@/lib/server/visits";

/**
 * Finds the pass that registered a personal device (IMEI / serial) on this site: passes still valid today or used
 * in the last day, so security can trace a device seen inside the plant. Returns the open visit when the owner is in.
 */
export async function lookupDevice(siteId: string, raw: string, now = new Date()): Promise<{ device: Device; pass: LoadedPass; visit: VisitSummary | null } | null> {
  const id = normalizeDeviceId(raw);
  if (id.length < 5) return null;
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db.pass.findMany({
    where: { siteId, validUntil: { gte: since }, status: { in: ["active", "used"] }, OR: [{ extra: { path: ["devices"], array_contains: [{ id }] } }, { extra: { path: ["devices"], array_contains: [{ imei: id }] } }] },
    select: { id: true, extra: true },
    orderBy: { validFrom: "desc" },
    take: 5,
  });
  for (const row of rows) {
    const device = readDevices(row.extra).find((d) => d.id === id || d.imei === id || normalizeDeviceId(d.serial) === id);
    if (!device) continue;
    const pass = await loadPass(row.id);
    if (!pass) continue;
    const visit = await db.visit.findFirst({ where: { passId: pass.id, siteId, status: { in: ["inside", "at_dock"] } }, select: visitSummarySelect, orderBy: { createdAt: "desc" } });
    return { device, pass, visit };
  }
  return null;
}

/** True when the kind's form has a required devices block and the pass registered nothing (nor declared "none"). */
export async function devicesRequiredMissing(pass: { siteId: string; kind: LoadedPass["kind"]; extra: unknown }): Promise<boolean> {
  if (devicesSatisfied(readDevices(pass.extra), readDevicesNone(pass.extra))) return false;
  const site = await db.site.findUnique({ where: { id: pass.siteId }, select: { settings: true } });
  if (site && readSiteSettings(site).requireDevices) return true;
  const { form } = await loadPolicyAndForm(pass.siteId, pass.kind);
  return form.elements.some((e) => e.type === "devices" && e.required);
}
