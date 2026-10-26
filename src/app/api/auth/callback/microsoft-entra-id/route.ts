import { NextResponse, type NextRequest } from "next/server";
import { finishEntraLogin } from "@/lib/auth/entra";
import { upsertUserFromEntra } from "@/lib/auth/users";
import { createSession } from "@/lib/auth/session";
import { listPanels } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export async function GET(request: NextRequest) {
  try {
    // Use APP_URL as the base so the redirect_uri matches what was registered even behind a proxy.
    const callbackUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, env().APP_URL);
    const { claims, next } = await finishEntraLogin(callbackUrl);
    const user = await upsertUserFromEntra(claims);
    if (user.status !== "active") return NextResponse.redirect(new URL("/login?error=disabled", env().APP_URL));
    await createSession(user.id);
    await audit({ action: "auth.login", actorId: user.id, meta: { via: "entra" } });
    const panels = await listPanels({ ...user, guardDeviceId: null });
    const target = next ?? (panels.length === 1 && panels[0] ? panels[0].href : "/select-panel");
    return NextResponse.redirect(new URL(target, env().APP_URL));
  } catch (err) {
    log.error("entra.callback_failed", { err: String(err) });
    return NextResponse.redirect(new URL("/login?error=entra", env().APP_URL));
  }
}
