"use server";

import { redirect } from "next/navigation";
import { requireKiosk } from "@/lib/auth/kiosk";
import { checkoutVisit, VisitError } from "@/lib/server/visits";

export async function checkoutAction(formData: FormData): Promise<void> {
  const { user, site } = await requireKiosk();
  const visitId = String(formData.get("visitId") ?? "");
  try {
    await checkoutVisit(visitId, site.id, user.id);
  } catch (err) {
    if (err instanceof VisitError) redirect("/guard/inside?error=1");
    throw err;
  }
  redirect("/guard/inside?ok=1");
}
