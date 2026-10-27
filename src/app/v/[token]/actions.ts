"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { docHash, docLast4, normalizePlate } from "@/lib/crypto/docHash";
import { upsertCompanyByName } from "@/lib/server/passes";
import { isOpenForVisitor, TOKEN_RE } from "@/lib/passes/visitor";

async function loadOpenPass(tokenRaw: unknown, scope: string) {
  const token = typeof tokenRaw === "string" ? tokenRaw : "";
  if (!TOKEN_RE.test(token)) notFound();
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`${scope}:ip:${ip}`, 20, 600);
  if (!limit.ok) redirect(`/v/${token}?error=rateLimited`);
  const pass = await db.pass.findUnique({ where: { token } });
  if (!pass) notFound();
  if (!isOpenForVisitor(pass)) redirect(`/v/${token}?error=closed`);
  return pass;
}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const preregSchema = z.object({ token: z.string(), doc: optional(40), phone: optional(40), plate: optional(20), company: optional(120) });

/** Visitor pre-registration from the public link: document → hash + last 4, phone, plate, company. */
export async function preregisterAction(formData: FormData): Promise<void> {
  const parsed = preregSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/v/${String(formData.get("token") ?? "")}?error=invalid`);
  const d = parsed.data;
  const pass = await loadOpenPass(d.token, "prereg");
  if (d.doc && d.doc.replace(/[^0-9a-z]/gi, "").length < 5) redirect(`/v/${pass.token}?error=invalid`);

  const data: { visitorDocHash?: string; visitorDocLast4?: string; visitorPhone?: string; plate?: string; companyId?: string } = {};
  if (d.doc && !pass.visitorDocHash) {
    data.visitorDocHash = docHash(d.doc, await getSecret("DOC_HASH_KEY"));
    data.visitorDocLast4 = docLast4(d.doc);
  }
  // Write-once like the document: what the host registered (and what the blacklist is matched against) stays.
  if (d.phone && !pass.visitorPhone) data.visitorPhone = d.phone;
  if (d.plate && !pass.plate) data.plate = normalizePlate(d.plate);
  if (d.company && !pass.companyId) data.companyId = (await upsertCompanyByName(d.company, pass.kind)).id;
  if (Object.keys(data).length > 0) await db.pass.update({ where: { id: pass.id }, data });
  redirect(`/v/${pass.token}?ok=prereg`);
}

const ndaSchema = z.object({ token: z.string(), ndaId: z.string().min(1), accept: z.literal("on"), name: z.string().trim().min(3).max(120) });

/** NDA / visitor policy acceptance. The typed name is the signature and is kept in the audit entry. */
export async function acceptNdaAction(formData: FormData): Promise<void> {
  const parsed = ndaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/v/${String(formData.get("token") ?? "")}?error=invalid`);
  const d = parsed.data;
  const pass = await loadOpenPass(d.token, "nda");
  const nda = await db.ndaVersion.findFirst({
    where: { OR: [{ siteId: pass.siteId }, { siteId: null }], activeFrom: { lte: new Date() } },
    orderBy: [{ siteId: { sort: "desc", nulls: "last" } }, { activeFrom: "desc" }],
  });
  if (!nda || nda.id !== d.ndaId) redirect(`/v/${pass.token}?error=invalid`);
  if (!pass.ndaAcceptedAt) {
    await db.pass.update({ where: { id: pass.id }, data: { ndaAcceptedAt: new Date(), ndaVersion: nda.version } });
    await audit({ action: "nda.accepted", siteId: pass.siteId, targetType: "Pass", targetId: pass.id, meta: { ndaVersionId: nda.id, version: nda.version, signedName: d.name } });
  }
  redirect(`/v/${pass.token}?ok=nda`);
}
