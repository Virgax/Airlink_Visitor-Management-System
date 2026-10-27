"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.email().max(200)]).optional(),
  department: z.string().trim().max(80).optional(),
  extension: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
  siteId: z.string().optional(),
  q: z.string().optional(),
});

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

function back(q: string | undefined, extra: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  return `/admin/employees?${params.toString()}${params.size ? "&" : ""}${extra}`;
}

/** Creates or edits a manual employee. Synced employees (SPN/Entra) are read-only here except for activation. */
export async function saveEmployeeAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(back(String(formData.get("q") ?? ""), "error=invalid"));
  const { id, name, department, extension, phone, q } = parsed.data;
  const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : null;
  const siteId = parsed.data.siteId ? parsed.data.siteId : null;
  if (siteId) assertSiteAllowed(tenant, siteId);
  if (!siteId && tenant.membership.siteId !== null) redirect(back(q, "error=forbidden"));
  const data = { name, email, department: department || null, extension: extension || null, phone: phone || null, siteId };

  try {
    if (id) {
      const existing = await db.employee.findUnique({ where: { id } });
      if (!existing) redirect(back(q, "error=invalid"));
      if (existing.siteId) assertSiteAllowed(tenant, existing.siteId);
      if (existing.source !== "manual") redirect(back(q, "error=synced"));
      await db.employee.update({ where: { id }, data });
      await audit({ action: "employee.changed", siteId, actorId: tenant.user.id, targetType: "Employee", targetId: id, meta: { op: "updated" } });
    } else {
      const created = await db.employee.create({ data: { ...data, source: "manual" } });
      await audit({ action: "employee.changed", siteId, actorId: tenant.user.id, targetType: "Employee", targetId: created.id, meta: { op: "created" } });
    }
  } catch (err) {
    if (isUnique(err)) redirect(back(q, `error=exists${id ? `&edit=${id}` : ""}`));
    throw err;
  }
  redirect(back(q, `ok=${id ? "saved" : "added"}`));
}

export async function toggleEmployeeAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const id = String(formData.get("id") ?? "");
  const q = String(formData.get("q") ?? "");
  const employee = await db.employee.findUnique({ where: { id } });
  if (!employee) redirect(back(q, "error=invalid"));
  if (employee.siteId) assertSiteAllowed(tenant, employee.siteId);
  const updated = await db.employee.update({ where: { id }, data: { active: !employee.active } });
  await audit({ action: "employee.changed", siteId: employee.siteId, actorId: tenant.user.id, targetType: "Employee", targetId: id, meta: { op: updated.active ? "activated" : "deactivated", source: employee.source } });
  redirect(back(q, "ok=saved"));
}
