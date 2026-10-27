"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getMembershipOrThrow } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  rnc: z.string().trim().max(20).optional(),
  kind: z.enum(["vendor", "contractor", "client", "carrier", "courier", "other"]),
  notes: z.string().trim().max(1000).optional(),
});

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Companies are shared by every site, so any admin may manage them. */
export async function saveCompanyAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/companies?error=invalid");
  const { id, name, rnc, kind, notes } = parsed.data;
  const data = { name, rnc: rnc || null, kind, notes: notes || null, blocked: formData.get("blocked") === "on" };
  try {
    if (id) {
      const company = await db.company.update({ where: { id }, data });
      await audit({ action: "company.changed", siteId: tenant.site?.id ?? null, actorId: tenant.user.id, targetType: "Company", targetId: company.id, meta: { op: "updated", ...data } });
    } else {
      const company = await db.company.create({ data });
      await audit({ action: "company.changed", siteId: tenant.site?.id ?? null, actorId: tenant.user.id, targetType: "Company", targetId: company.id, meta: { op: "created", ...data } });
    }
  } catch (err) {
    if (isUnique(err)) redirect(`/admin/companies?error=exists${id ? `&edit=${id}` : ""}`);
    throw err;
  }
  redirect(`/admin/companies?ok=${id ? "saved" : "added"}`);
}

export async function toggleCompanyBlockedAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const id = String(formData.get("id") ?? "");
  const company = await db.company.findUnique({ where: { id } });
  if (!company) redirect("/admin/companies?error=invalid");
  const updated = await db.company.update({ where: { id }, data: { blocked: !company.blocked } });
  await audit({ action: "company.changed", siteId: tenant.site?.id ?? null, actorId: tenant.user.id, targetType: "Company", targetId: id, meta: { op: updated.blocked ? "blocked" : "unblocked" } });
  redirect("/admin/companies?ok=saved");
}
