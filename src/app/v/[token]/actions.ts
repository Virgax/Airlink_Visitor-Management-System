"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { docHash, docLast4, normalizePlate } from "@/lib/crypto/docHash";
import { upsertCompanyByName } from "@/lib/server/passes";
import { loadPolicyAndForm } from "@/lib/server/forms";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import { collectAnswers, elementsFor, mergeAnswers, readAnswers } from "@/lib/forms/schema";
import { mediaConfigured, mediaKey, putFile, sniffImage } from "@/lib/media/putFile";
import { canEditFromLink, isOpenForVisitor, registrationPending, TOKEN_RE } from "@/lib/passes/visitor";
import { log } from "@/lib/log";

async function loadOpenPass(tokenRaw: unknown, scope: string, mode: "edit" | "nda" = "edit") {
  const token = typeof tokenRaw === "string" ? tokenRaw : "";
  if (!TOKEN_RE.test(token)) notFound();
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`${scope}:ip:${ip}`, 20, 600);
  if (!limit.ok) redirect(`/v/${token}?error=rateLimited`);
  const pass = await db.pass.findUnique({ where: { token } });
  if (!pass) notFound();
  // Pre-registration closes once a self-registered link is completed (the link is consumed); the NDA step does not.
  const open = mode === "nda" ? isOpenForVisitor(pass) : canEditFromLink(pass);
  if (!open) redirect(`/v/${token}?error=closed`);
  return pass;
}

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const preregSchema = z.object({
  token: z.string(),
  name: optional(120),
  doc: optional(40),
  phone: optional(40),
  email: z.string().trim().max(200).optional().transform((v) => (v ? v.toLowerCase() : null)).refine((v) => v === null || z.string().email().safeParse(v).success),
  plate: optional(20),
  company: optional(120),
});

/** Visitor pre-registration from the public link: document → hash + last 4, phone, plate, company. */
export async function preregisterAction(formData: FormData): Promise<void> {
  const parsed = preregSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/v/${String(formData.get("token") ?? "")}?error=invalid`);
  const d = parsed.data;
  const pass = await loadOpenPass(d.token, "prereg");
  if (d.doc && d.doc.replace(/[^0-9a-z]/gi, "").length < 5) redirect(`/v/${pass.token}?error=invalid`);

  const data: { visitorName?: string; registeredAt?: Date; visitorDocHash?: string; visitorDocLast4?: string; visitorPhone?: string; visitorEmail?: string; plate?: string; companyId?: string; extra?: Prisma.InputJsonObject } = {};
  // Invitation link: the visitor names themselves; from then on the link belongs to that person.
  const registering = registrationPending(pass);
  if (registering) {
    if (!d.name || d.name.length < 2) redirect(`/v/${pass.token}?error=invalid`);
    data.visitorName = d.name;
    data.registeredAt = new Date();
  }
  if (d.doc && !pass.visitorDocHash) {
    data.visitorDocHash = docHash(d.doc, await getSecret("DOC_HASH_KEY"));
    data.visitorDocLast4 = docLast4(d.doc);
  }
  // Write-once like the document: what the host registered (and what the blacklist is matched against) stays.
  if (d.phone && !pass.visitorPhone) data.visitorPhone = d.phone;
  if (d.email && !pass.visitorEmail) data.visitorEmail = d.email;
  if (d.plate && !pass.plate) data.plate = normalizePlate(d.plate);
  if (d.company && !pass.companyId) data.companyId = (await upsertCompanyByName(d.company, pass.kind)).id;

  // Custom questions of the visitor surface: merged over what the host answered, then re-validated as a whole.
  const { policy, form } = await loadPolicyAndForm(pass.siteId, pass.kind);
  const collected = collectAnswers(form.elements, "visitor", formData);
  if (collected.invalid.length) redirect(`/v/${pass.token}?error=invalid`);
  const answers = mergeAnswers(readAnswers(pass.extra), collected.answers);
  if (Object.keys(collected.answers).length) data.extra = { ...((pass.extra as Prisma.JsonObject | null) ?? {}), answers } as Prisma.InputJsonObject;
  const evaluation = evaluatePolicy(policy, {
    kind: pass.kind,
    visitorDocHash: data.visitorDocHash ?? pass.visitorDocHash,
    plate: data.plate ?? pass.plate,
    form: form.elements,
    surface: "visitor",
    answers,
    visitorPhone: data.visitorPhone ?? pass.visitorPhone,
    visitorEmail: data.visitorEmail ?? pass.visitorEmail,
    company: data.companyId ?? pass.companyId,
    ndaAcceptedAt: pass.ndaAcceptedAt ?? new Date(), // the NDA has its own form; it is not missing here
  });
  if (evaluation.missing.length > 0) redirect(`/v/${pass.token}?error=missing`);
  if (Object.keys(data).length > 0) await db.pass.update({ where: { id: pass.id }, data });
  if (registering) {
    await audit({ action: "pass.updated", siteId: pass.siteId, targetType: "Pass", targetId: pass.id, meta: { field: "selfRegistered", groupId: pass.groupId } });
    redirect(`/v/${pass.token}?ok=registered`);
  }
  redirect(`/v/${pass.token}?ok=prereg`);
}

const ndaSchema = z.object({
  token: z.string(),
  ndaId: z.string().min(1),
  accept: z.literal("on"),
  name: z.string().trim().max(120).optional().transform((v) => (v ? v : null)),
  signature: z.string().max(400_000).optional().transform((v) => (v ? v : null)),
});

const MAX_SIGNATURE_BYTES = 300_000;

/** Decodes the signature pad's PNG data URL; null when it is not a PNG of a sane size. */
function decodeSignature(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[1]!, "base64"));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SIGNATURE_BYTES || sniffImage(bytes) !== "image/png") return null;
  return bytes;
}

/**
 * NDA / visitor policy acceptance. With a `signature` element on the form the drawn signature (PNG) is stored in
 * the bucket under `s/<siteId>/nda/<passId>.png` and its hash kept in the audit entry; the typed full name stays as
 * the fallback (and the only option when the form has no signature element). One of the two is required.
 */
export async function acceptNdaAction(formData: FormData): Promise<void> {
  const parsed = ndaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/v/${String(formData.get("token") ?? "")}?error=invalid`);
  const d = parsed.data;
  const pass = await loadOpenPass(d.token, "nda", "nda");
  const { form } = await loadPolicyAndForm(pass.siteId, pass.kind);
  const signatureElement = elementsFor(form.elements, "visitor").find((e) => e.type === "signature");
  const signature = signatureElement ? decodeSignature(d.signature) : null;
  if (!signature && (!d.name || d.name.length < 3)) redirect(`/v/${pass.token}?error=invalid`);
  const nda = await db.ndaVersion.findFirst({
    where: { OR: [{ siteId: pass.siteId }, { siteId: null }], activeFrom: { lte: new Date() } },
    orderBy: [{ siteId: { sort: "desc", nulls: "last" } }, { activeFrom: "desc" }],
  });
  if (!nda || nda.id !== d.ndaId) redirect(`/v/${pass.token}?error=invalid`);
  if (!pass.ndaAcceptedAt) {
    let signatureKey: string | null = null;
    let signatureHash: string | null = null;
    if (signature) {
      signatureHash = createHash("sha256").update(signature).digest("hex");
      if (mediaConfigured()) {
        signatureKey = mediaKey(pass.siteId, "nda", pass.id, "image/png");
        try {
          await putFile(signatureKey, signature, "image/png");
        } catch (err) {
          log.error("nda.signature_store_failed", { passId: pass.id, err: String(err) });
          signatureKey = null;
        }
      }
    }
    await db.pass.update({ where: { id: pass.id }, data: { ndaAcceptedAt: new Date(), ndaVersion: nda.version } });
    await audit({
      action: "nda.accepted",
      siteId: pass.siteId,
      targetType: "Pass",
      targetId: pass.id,
      meta: { ndaVersionId: nda.id, version: nda.version, signedName: d.name, signature: signature ? "drawn" : "typed", signatureKey, signatureHash },
    });
  }
  redirect(`/v/${pass.token}?ok=nda`);
}
