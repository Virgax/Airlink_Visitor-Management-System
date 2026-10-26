export const dynamic = "force-dynamic";

/** VAPID public key for `PushManager.subscribe`. 404 when Web Push is not configured. */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey || !process.env.VAPID_PRIVATE_KEY) {
    return Response.json({ ok: false, error: "push_not_configured" }, { status: 404 });
  }
  return Response.json({ ok: true, publicKey }, { headers: { "cache-control": "no-store" } });
}
