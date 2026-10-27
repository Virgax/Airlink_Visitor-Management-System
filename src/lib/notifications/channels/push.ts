import webpush from "web-push";
import { log } from "@/lib/log";
import { getSecret } from "@/lib/secrets";
import { isFakeMode, recordFake } from "@/lib/notifications/fake";
import { URGENT_TYPES } from "@/lib/notifications/types";
import { errorMessage, type Channel, type ChannelMessage, type ChannelResult } from "./types";

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };

let vapidReady = false;

/** VAPID pair from Railway variables or the server-generated SystemSecret rows. */
export async function vapid(): Promise<{ publicKey: string; privateKey: string; subject: string } | null> {
  const [publicKey, privateKey] = await Promise.all([getSecret("VAPID_PUBLIC_KEY"), getSecret("VAPID_PRIVATE_KEY")]);
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "mailto:it@airlinkdr.com" };
}

async function ensureVapid(): Promise<boolean> {
  const v = await vapid();
  if (!v) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
    vapidReady = true;
  }
  return true;
}

/** Payload read by public/sw.js (`push` event). Kept small: push services cap it at ~4 KB. */
export function pushPayload(message: ChannelMessage): string {
  return JSON.stringify({ title: message.title, body: message.body, url: message.url, type: message.type });
}

/** Web Push over VAPID (`web-push`). Subscriptions answering 404/410 are reported as `dropped`. */
export const pushChannel: Channel<PushTarget> = {
  name: "push",
  // The VAPID pair is generated on first boot when not set, so push is always configured once the DB is up.
  configured: () => true,
  async send(message, target): Promise<ChannelResult> {
    if (isFakeMode()) {
      recordFake({ channel: "push", to: target.endpoint, type: message.type, title: message.title, body: message.body, url: message.url });
      return { ok: true };
    }
    if (!(await ensureVapid())) return { ok: false, error: "vapid_not_configured" };
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        pushPayload(message),
        { TTL: 15 * 60, urgency: URGENT_TYPES.has(message.type) ? "high" : "normal" },
      );
      return { ok: true };
    } catch (err) {
      const status = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : 0;
      const dropped = status === 404 || status === 410;
      log.warn("push.failed", { status, dropped, subscription: target.id, err: errorMessage(err) });
      return { ok: false, error: errorMessage(err), dropped };
    }
  },
};
