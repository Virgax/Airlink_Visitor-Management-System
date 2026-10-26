import "server-only";
import { AuthError } from "@/lib/auth/guards";
import { getKioskOrThrow, type KioskContext } from "@/lib/auth/kiosk";
import { VisitError } from "@/lib/server/visits";
import { log } from "@/lib/log";

/** Runs a kiosk route handler with the kiosk context; maps auth/visit errors to JSON responses. */
export async function kioskRoute(handler: (kiosk: KioskContext) => Promise<Response>): Promise<Response> {
  try {
    const kiosk = await getKioskOrThrow();
    return await handler(kiosk);
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ ok: false, error: err.code }, { status: 401 });
    if (err instanceof VisitError) return Response.json({ ok: false, error: err.code }, { status: err.code === "not_found" ? 404 : 409 });
    log.error("guard.route_failed", { err: String(err) });
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
