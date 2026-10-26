"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { isProd } from "@/lib/env";

export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (isLocale(locale)) {
    const jar = await cookies();
    jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", secure: isProd() });
  }
  const ref = (await headers()).get("referer");
  redirect(ref && ref.startsWith("/") ? ref : safeRefererPath(ref));
}

function safeRefererPath(ref: string | null): string {
  if (!ref) return "/";
  try {
    const u = new URL(ref);
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}
