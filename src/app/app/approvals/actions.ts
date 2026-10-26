"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSiteAllowed, AuthError } from "@/lib/auth/guards";
import { getApproverTenants } from "@/lib/server/approvals";
import { approvePass, approverRoleFor, denyPass } from "@/lib/server/passes";

/** Loads a pending pass and the tenant whose role the policy names for it; re-checks the site. */
async function authorize(passIdRaw: unknown) {
  const { user, tenants } = await getApproverTenants();
  const passId = typeof passIdRaw === "string" ? passIdRaw : "";
  const pass = await db.pass.findFirst({ where: { id: passId, status: "pending_approval" }, select: { id: true, siteId: true, kind: true } });
  if (!pass) redirect("/app/approvals?error=1");
  const role = await approverRoleFor(pass.siteId, pass.kind);
  const tenant = role === "approver" || role === "security" ? tenants[role] : undefined;
  if (!tenant) throw new AuthError("forbidden");
  assertSiteAllowed(tenant, pass.siteId);
  if (tenant.membership.siteId !== null && !tenant.sites.some((s) => s.id === pass.siteId)) throw new AuthError("forbidden");
  return { user, pass };
}

export async function approvePassAction(formData: FormData): Promise<void> {
  const { user, pass } = await authorize(formData.get("passId"));
  const updated = await approvePass(pass.id, user.id);
  redirect(updated?.status === "active" ? "/app/approvals?ok=approved" : "/app/approvals?error=1");
}

export async function denyPassAction(formData: FormData): Promise<void> {
  const { user, pass } = await authorize(formData.get("passId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || null;
  const updated = await denyPass(pass.id, user.id, reason);
  redirect(updated?.status === "denied" ? "/app/approvals?ok=denied" : "/app/approvals?error=1");
}
