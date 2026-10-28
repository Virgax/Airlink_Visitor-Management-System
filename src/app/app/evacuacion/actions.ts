"use server";

import { redirect } from "next/navigation";
import { getEvacuationAccess, notifyEvacuationList } from "@/lib/server/evacuation";
import { rateLimit } from "@/lib/rateLimit";

/** Admin/security: pushes the evacuation list to the site's fire wardens. */
export async function sendEvacuationListAction(formData: FormData): Promise<void> {
  const access = await getEvacuationAccess();
  const siteId = String(formData.get("siteId") ?? "");
  const site = access.sites.find((s) => s.id === siteId);
  if (!access.canSend || !site) redirect("/app/evacuacion?error=forbidden");
  const limit = await rateLimit(`evacuation-send:user:${access.user.id}`, 6, 600);
  if (!limit.ok) redirect("/app/evacuacion?error=rateLimited");
  const count = await notifyEvacuationList(site.id, access.user.id, "manual");
  redirect(`/app/evacuacion?sent=${count}&site=${encodeURIComponent(site.id)}`);
}
