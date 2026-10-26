"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, listPanels } from "@/lib/auth/guards";
import { SITE_COOKIE } from "@/lib/auth/session";
import { isProd } from "@/lib/env";

const schema = z.object({ href: z.string().startsWith("/"), siteId: z.string().optional() });

export async function openPanelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/select-panel");
  const panels = await listPanels(user);
  const match = panels.find((p) => p.href === parsed.data.href && (p.siteId ?? "") === (parsed.data.siteId ?? ""));
  if (!match) redirect("/select-panel");
  const jar = await cookies();
  if (match.siteId) jar.set(SITE_COOKIE, match.siteId, { path: "/", httpOnly: true, sameSite: "lax", secure: isProd(), maxAge: 365 * 86_400 });
  else jar.delete(SITE_COOKIE);
  redirect(match.href);
}
