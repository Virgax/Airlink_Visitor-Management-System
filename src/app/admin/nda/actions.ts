"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getMembershipOrThrow } from "@/lib/auth/guards";
import { randomToken } from "@/lib/crypto/tokens";
import { mediaConfigured, mediaKey, putPdf, sniffPdf } from "@/lib/media/putFile";
import { zonedToUtc } from "@/lib/time/tz";

const MAX_PDF_BYTES = 5 * 1024 * 1024;

const schema = z.object({
  siteId: z.string().max(64).optional().transform((v) => (v ? v : null)),
  version: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9.-]+$/),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(20_000),
  titleEn: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  bodyEn: z.string().trim().max(20_000).optional().transform((v) => (v ? v : null)),
  activeFrom: z.string().max(30).optional().transform((v) => (v ? v : null)),
});

/**
 * Publishes a new version of the visitor policy (NDA) for one site or for every site. Versions are immutable: what a
 * visitor accepted (version + text) must stay as it was, so corrections are a new version. Optional PDF attachment
 * (shown to the visitor before accepting) goes to the private bucket under `s/<siteId|all>/nda/`.
 */
export async function publishNdaAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/nda?error=invalid");
  const d = parsed.data;
  // Site-bound admins publish for their site only; "every site" needs the company-wide admin.
  if (d.siteId) {
    if (!tenant.sites.some((s) => s.id === d.siteId)) redirect("/admin/nda?error=forbidden");
  } else if (tenant.membership.siteId !== null) {
    redirect("/admin/nda?error=forbidden");
  }
  const site = d.siteId ? await db.site.findUnique({ where: { id: d.siteId } }) : null;
  const activeFrom = d.activeFrom ? zonedToUtc(d.activeFrom, site?.timezone ?? "America/Santo_Domingo") : new Date();
  if (!activeFrom) redirect("/admin/nda?error=invalid");
  const exists = await db.ndaVersion.findFirst({ where: { siteId: d.siteId, version: d.version }, select: { id: true } });
  if (exists) redirect("/admin/nda?error=exists");

  let attachmentKey: string | null = null;
  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    if (!mediaConfigured()) redirect("/admin/nda?error=media");
    if (file.size > MAX_PDF_BYTES) redirect("/admin/nda?error=tooBig");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!sniffPdf(bytes)) redirect("/admin/nda?error=notPdf");
    attachmentKey = mediaKey(d.siteId ?? "all", "nda", `${d.version}-${randomToken(6)}`, "application/pdf");
    await putPdf(attachmentKey, bytes);
  }

  const nda = await db.ndaVersion.create({ data: { siteId: d.siteId, version: d.version, title: d.title, body: d.body, titleEn: d.titleEn, bodyEn: d.bodyEn, activeFrom, attachmentKey } });
  await audit({ action: "nda.published", siteId: d.siteId, actorId: tenant.user.id, targetType: "NdaVersion", targetId: nda.id, meta: { version: nda.version, english: Boolean(d.bodyEn), attachment: Boolean(attachmentKey), activeFrom: activeFrom.toISOString() } });
  redirect("/admin/nda?ok=published");
}
