"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { parseHHmm } from "@/lib/time/tz";
import { parsePrefs } from "@/lib/notifications/types";

const PAGE = "/account/notifications";

/** Quiet hours (both or none, "HH:mm") and email fallback. Stored in NotificationPref. */
export async function savePrefsAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user || user.guardDeviceId) redirect(`/login?next=${encodeURIComponent(PAGE)}`);
  const quietFrom = String(formData.get("quietFrom") ?? "").trim();
  const quietTo = String(formData.get("quietTo") ?? "").trim();
  const emailFallback = formData.get("emailFallback") === "on";

  let window: { quietFrom: string | null; quietTo: string | null };
  if (!quietFrom && !quietTo) window = { quietFrom: null, quietTo: null };
  else if (parseHHmm(quietFrom) !== null && parseHHmm(quietTo) !== null) window = { quietFrom, quietTo };
  else redirect(`${PAGE}?error=invalid`);

  const existing = await db.notificationPref.findUnique({ where: { userId: user.id }, select: { prefs: true } });
  const current = parsePrefs(existing?.prefs);
  const prefs = { emailFallback, ...(current.timeZone ? { timeZone: current.timeZone } : {}) };
  await db.notificationPref.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...window, prefs },
    update: { ...window, prefs },
  });
  redirect(`${PAGE}?ok=saved`);
}
