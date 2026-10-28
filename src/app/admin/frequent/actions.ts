"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { log } from "@/lib/log";
import { mediaConfigured, mediaKey, putFile, sniffImage } from "@/lib/media/putFile";
import { buildSchedule, checkWindowRange, uniqueIds } from "@/lib/passes/form";
import { isPassPin, normalizePin } from "@/lib/people/pin";
import { createFrequentVisitor, deactivateFrequentVisitor, setFrequentPhoto, updateFrequentVisitor, type FrequentInput } from "@/lib/server/frequent";
import { zonedToUtc } from "@/lib/time/tz";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const schema = z.object({
  id: optional(64),
  siteId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(120),
  company: optional(120),
  doc: optional(40),
  phone: optional(40),
  signIn: z.enum(["qr_card", "pin"]),
  pin: optional(20),
  hostEmployeeId: z.string().min(1).max(64),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
  scheduleFrom: optional(5),
  scheduleTo: optional(5),
  note: optional(500),
});

function fail(id: string | null, siteId: string, error: string): never {
  redirect(id ? `/admin/frequent/${id}?error=${error}` : `/admin/frequent/new?siteId=${encodeURIComponent(siteId)}&error=${error}`);
}

/** Creates or updates a frequent visitor and its recurring pass; optional photo through `putFile`. */
export async function saveFrequentAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const siteIdRaw = typeof raw.siteId === "string" ? raw.siteId : "";
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(id, siteIdRaw, "invalid");
  const d = parsed.data;
  assertSiteAllowed(tenant, d.siteId);
  const site = await db.site.findFirst({ where: { id: d.siteId, active: true } });
  if (!site) fail(id, d.siteId, "site");

  const validFrom = zonedToUtc(d.validFrom, site.timezone);
  const validUntil = zonedToUtc(d.validUntil, site.timezone);
  if (!validFrom || !validUntil) fail(id, site.id, "invalid");
  const windowError = checkWindowRange(validFrom, validUntil, new Date());
  if (windowError) fail(id, site.id, windowError);
  const schedule = buildSchedule({ days: formData.getAll("days"), from: d.scheduleFrom, to: d.scheduleTo });
  if (!schedule) fail(id, site.id, "schedule");

  const pin = d.pin ? normalizePin(d.pin) : null;
  if (d.pin && !isPassPin(pin ?? "")) fail(id, site.id, "pin");
  const host = await db.employee.findFirst({ where: { id: d.hostEmployeeId, active: true, OR: [{ siteId: site.id }, { siteId: null }] }, select: { id: true } });
  if (!host) fail(id, site.id, "host");
  const areaIds = uniqueIds(formData.getAll("areaIds"));
  const areas = areaIds.length ? await db.area.findMany({ where: { id: { in: areaIds }, siteId: site.id, active: true }, select: { id: true } }) : [];

  // Photo: sniffed bytes, re-encoded by putFile; silently skipped when the bucket is not configured.
  const photo = formData.get("photo");
  let bytes: Uint8Array | null = null;
  let type: ReturnType<typeof sniffImage> = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_PHOTO_BYTES) fail(id, site.id, "photoSize");
    bytes = new Uint8Array(await photo.arrayBuffer());
    type = sniffImage(bytes);
    if (!type) fail(id, site.id, "photoType");
    if (!mediaConfigured()) bytes = null;
  }

  const input: FrequentInput = {
    siteId: site.id,
    name: d.name,
    companyName: d.company,
    doc: d.doc,
    phone: d.phone,
    signIn: d.signIn,
    pin: d.signIn === "pin" ? pin : null,
    hostEmployeeId: host.id,
    areaIds: areas.map((a) => a.id),
    validFrom,
    validUntil,
    schedule,
    note: d.note,
    ndaAccepted: formData.get("ndaAccepted") === "on",
    actorId: tenant.user.id,
  };
  let wasInactive = false;
  if (id) {
    const current = await db.frequentVisitor.findFirst({ where: { id, siteId: site.id }, select: { active: true } });
    if (!current) fail(null, site.id, "notFound");
    wasInactive = !current.active;
  }
  const result = id ? await updateFrequentVisitor(id, input) : await createFrequentVisitor(input);
  if (!result.ok) fail(id, site.id, result.error === "pin_required" ? "pin" : result.error === "nda_required" ? "nda" : result.error === "not_found" ? "notFound" : result.error);

  if (bytes && type) {
    const key = mediaKey(site.id, "frequent", result.id, type);
    try {
      await putFile(key, bytes, type);
      await setFrequentPhoto(result.id, key);
    } catch (err) {
      log.error("frequent.photo_failed", { id: result.id, err: String(err) });
    }
  }
  redirect(`/admin/frequent?ok=${id ? (wasInactive ? "activated" : "saved") : "created"}`);
}

export async function deactivateFrequentAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const id = String(formData.get("id") ?? "");
  const row = await db.frequentVisitor.findUnique({ where: { id }, select: { siteId: true } });
  if (!row) redirect("/admin/frequent?error=notFound");
  assertSiteAllowed(tenant, row.siteId);
  await deactivateFrequentVisitor(id, row.siteId, tenant.user.id);
  redirect("/admin/frequent?ok=deactivated");
}
