"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { VisitKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { DEFAULT_POLICIES } from "@/lib/policies/evaluate";
import { getManagedSite } from "@/lib/server/sites";

const KINDS = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"] as const;

const schema = z.object({
  siteId: z.string().min(1),
  kind: z.enum(KINDS),
  approverRole: z.enum(["", "admin", "security", "approver", "host"]).default(""),
  maxDurationMin: z.union([z.literal(""), z.coerce.number().int().min(5).max(7 * 24 * 60)]).default(""),
});

const on = (formData: FormData, key: string) => formData.get(key) === "on";

export async function savePolicyAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  const back = `/admin/policies?site=${encodeURIComponent(String(formData.get("siteId") ?? ""))}`;
  if (!parsed.success) redirect(`${back}&error=invalid`);
  const { siteId, kind, approverRole, maxDurationMin } = parsed.data;
  const site = await getManagedSite(tenant, siteId);
  if (!site) redirect("/admin/policies?error=invalid");
  const gateIds = formData.getAll("allowedGateIds").map(String).filter(Boolean);
  const siteGates = gateIds.length ? await db.gate.findMany({ where: { id: { in: gateIds }, siteId: site.id }, select: { id: true } }) : [];
  const data = {
    requiresApproval: on(formData, "requiresApproval"),
    approverRole: approverRole || null,
    requiresDoc: on(formData, "requiresDoc"),
    requiresNda: on(formData, "requiresNda"),
    escortRequired: on(formData, "escortRequired"),
    badge: on(formData, "badge"),
    receptionOnly: on(formData, "receptionOnly"),
    allowedGateIds: siteGates.map((g) => g.id),
    maxDurationMin: maxDurationMin === "" ? null : maxDurationMin,
  };
  const policy = await db.visitPolicy.upsert({ where: { siteId_kind: { siteId: site.id, kind } }, create: { siteId: site.id, kind, ...data }, update: data });
  await audit({ action: "policy.changed", siteId: site.id, actorId: tenant.user.id, targetType: "VisitPolicy", targetId: policy.id, meta: { kind, ...data } });
  redirect(`${back}&ok=saved#policy-${kind}`);
}

export async function resetPolicyAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const siteId = String(formData.get("siteId") ?? "");
  const kind = String(formData.get("kind") ?? "") as VisitKind;
  const back = `/admin/policies?site=${encodeURIComponent(siteId)}`;
  if (!KINDS.includes(kind)) redirect(`${back}&error=invalid`);
  const site = await getManagedSite(tenant, siteId);
  if (!site) redirect("/admin/policies?error=invalid");
  const data = DEFAULT_POLICIES[kind];
  const policy = await db.visitPolicy.upsert({ where: { siteId_kind: { siteId: site.id, kind } }, create: { siteId: site.id, kind, ...data }, update: data });
  await audit({ action: "policy.changed", siteId: site.id, actorId: tenant.user.id, targetType: "VisitPolicy", targetId: policy.id, meta: { kind, reset: true } });
  redirect(`${back}&ok=reset#policy-${kind}`);
}
