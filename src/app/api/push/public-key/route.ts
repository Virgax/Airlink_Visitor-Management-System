import { vapid } from "@/lib/notifications/channels/push";

export const dynamic = "force-dynamic";

/** VAPID public key for `PushManager.subscribe`. 404 only when the key cannot be resolved (DB down before first boot). */
export async function GET() {
  const v = await vapid().catch(() => null);
  if (!v) return Response.json({ ok: false, error: "push_not_configured" }, { status: 404 });
  return Response.json({ ok: true, publicKey: v.publicKey }, { headers: { "cache-control": "no-store" } });
}
