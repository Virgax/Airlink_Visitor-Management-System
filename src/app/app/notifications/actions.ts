"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { canDecideVisit, decideVisit } from "@/lib/server/visits";
import { renderNotification } from "@/lib/notifications/render";
import { isNotificationType } from "@/lib/notifications/types";

const PAGE = "/app/notifications";

async function me() {
  const user = await getSessionUser();
  if (!user || user.guardDeviceId) redirect(`/login?next=${encodeURIComponent(PAGE)}`);
  return user;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await me();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  await db.notification.updateMany({ where: { id: parsed.data.id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  redirect(PAGE);
}

export async function markAllReadAction(): Promise<void> {
  const user = await me();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  redirect(`${PAGE}?ok=read`);
}

/** Marks the notification read and follows its deep link (relative paths only). */
export async function openAction(formData: FormData): Promise<void> {
  const user = await me();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const n = await db.notification.findFirst({ where: { id: parsed.data.id, userId: user.id } });
  if (!n) redirect(`${PAGE}?error=invalid`);
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const payload = n.payload && typeof n.payload === "object" && !Array.isArray(n.payload) ? (n.payload as Record<string, unknown>) : {};
  const url = isNotificationType(n.type) ? renderNotification(n.type, payload, user.locale ?? "es").url : PAGE;
  redirect(url.startsWith("/") && !url.startsWith("//") ? url : PAGE);
}

const decisionSchema = z.object({
  id: z.string().min(1).max(64),
  visitId: z.string().min(1).max(64),
  decision: z.enum(["approve", "deny", "onMyWay"]),
});

/** Host (or site security/admin) decides on a pending unannounced visit from its notification. */
export async function decideVisitAction(formData: FormData): Promise<void> {
  const user = await me();
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const { id, visitId, decision } = parsed.data;
  // The visit id comes from the form: re-check it belongs to this notification and the user may decide on it.
  const n = await db.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, payload: true } });
  const payloadVisitId = n && n.payload && typeof n.payload === "object" && !Array.isArray(n.payload) ? (n.payload as Record<string, unknown>).visitId : null;
  if (!n || payloadVisitId !== visitId) redirect(`${PAGE}?error=invalid`);
  const visit = await db.visit.findUnique({ where: { id: visitId }, select: { id: true, siteId: true, hostEmployeeId: true } });
  if (!visit) redirect(`${PAGE}?error=gone`);
  if (!(await canDecideVisit(user, visit))) redirect(`${PAGE}?error=forbidden`);
  const result = await decideVisit(visitId, decision === "deny" ? "denied" : "approved", user.id, { note: decision === "onMyWay" ? "on_my_way" : undefined, via: "app" });
  await db.notification.updateMany({ where: { id: n.id, readAt: null }, data: { readAt: new Date() } });
  if (!result) redirect(`${PAGE}?error=gone`);
  redirect(`${PAGE}?ok=${decision === "approve" ? "approved" : decision === "deny" ? "denied" : "onMyWay"}`);
}
