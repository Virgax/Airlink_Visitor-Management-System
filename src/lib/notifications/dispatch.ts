import "server-only";
import { createTranslator } from "next-intl";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getSecret } from "@/lib/secrets";
import { emailChannel } from "@/lib/notifications/channels/email";
import { pushChannel } from "@/lib/notifications/channels/push";
import { teamsChannel, type TeamsFact } from "@/lib/notifications/channels/teams";
import { absoluteUrl, type ChannelMessage } from "@/lib/notifications/channels/types";
import { DEFAULT_TIMEZONE, shouldDeliverNow } from "@/lib/notifications/quietHours";
import { renderNotification } from "@/lib/notifications/render";
import { signTeamsAction } from "@/lib/notifications/teamsAction";
import { EMAIL_ALWAYS_TYPES, TEAMS_TYPES, parsePrefs, type NotificationType, type NotificationPrefs } from "@/lib/notifications/types";
import { defaultLocale } from "@/i18n/config";

export type DispatchInput = {
  type: NotificationType;
  siteId: string | null;
  payload: Record<string, unknown>;
  userIds: string[];
  /** Plain e-mail addresses (policy recipients); rendered in the default locale, no quiet hours. */
  extraEmails?: string[];
  now?: Date;
};

const MESSAGES = { es, en } as const;
const teamsT = createTranslator({ locale: "es", messages: es, namespace: "notifications.teams" });

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function teamsFacts(payload: Record<string, unknown>, siteName: string | null): TeamsFact[] {
  const facts: TeamsFact[] = [];
  const site = siteName ?? str(payload.siteName);
  if (site) facts.push({ name: teamsT("site"), value: site });
  const gate = str(payload.gateName);
  if (gate) facts.push({ name: teamsT("gate"), value: gate });
  const host = str(payload.hostName);
  if (host) facts.push({ name: teamsT("host"), value: host });
  const company = str(payload.company);
  if (company) facts.push({ name: teamsT("company"), value: company });
  return facts;
}

async function teamsActions(type: NotificationType, payload: Record<string, unknown>, now: Date): Promise<{ approveUrl: string; denyUrl: string } | undefined> {
  const secret = await getSecret("TEAMS_ACTION_SECRET");
  if (!secret) return undefined;
  const visitId = str(payload.visitId);
  const passId = str(payload.passId);
  const target = type === "visit_at_gate" && visitId ? { kind: "visit" as const, id: visitId } : type === "pass_pending_approval" && passId ? { kind: "pass" as const, id: passId } : null;
  if (!target) return undefined;
  const link = (decision: "approved" | "denied") => absoluteUrl(`/api/teams/action?token=${encodeURIComponent(signTeamsAction({ ...target, decision }, secret, now))}`);
  return { approveUrl: link("approved"), denyUrl: link("denied") };
}

async function sendTeams(input: DispatchInput, siteName: string | null, now: Date): Promise<void> {
  if (!TEAMS_TYPES.has(input.type) || !teamsChannel.configured()) return;
  const rendered = renderNotification(input.type, input.payload, defaultLocale);
  const message: ChannelMessage = { ...rendered, url: absoluteUrl(rendered.url), type: input.type, locale: defaultLocale, siteId: input.siteId, payload: input.payload };
  const res = await teamsChannel.send(message, {
    facts: teamsFacts(input.payload, siteName),
    labels: { approve: teamsT("approve"), deny: teamsT("deny"), openApp: teamsT("openApp") },
    actions: await teamsActions(input.type, input.payload, now),
  });
  if (!res.ok) log.warn("notify.channel_failed", { channel: "teams", type: input.type, error: res.error });
}

type Recipient = {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  notificationPref: { quietFrom: string | null; quietTo: string | null; prefs: unknown } | null;
  pushSubscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
};

async function sendEmail(user: Recipient, message: ChannelMessage): Promise<void> {
  if (!emailChannel.configured() || !user.email) return;
  const t = createTranslator({ locale: message.locale, messages: message.locale === "en" ? MESSAGES.en : MESSAGES.es, namespace: "notifications.email" });
  const res = await emailChannel.send(message, { to: user.email, name: user.name, labels: { open: t("open"), footer: t("footer") } });
  if (!res.ok) log.warn("notify.channel_failed", { channel: "email", type: message.type, userId: user.id, error: res.error });
}

/** Policy recipients (`VisitPolicy.notifyEmails`): plain addresses, default locale, no preferences involved. */
async function sendExtraEmails(input: DispatchInput): Promise<void> {
  const emails = [...new Set((input.extraEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0 || !emailChannel.configured()) return;
  const rendered = renderNotification(input.type, input.payload, defaultLocale);
  const message: ChannelMessage = { ...rendered, url: absoluteUrl(rendered.url), type: input.type, locale: defaultLocale, siteId: input.siteId, payload: input.payload };
  const t = createTranslator({ locale: defaultLocale, messages: MESSAGES[defaultLocale], namespace: "notifications.email" });
  const labels = { open: t("open"), footer: t("footer") };
  await Promise.all(
    emails.map(async (to) => {
      const res = await emailChannel.send(message, { to, labels });
      if (!res.ok) log.warn("notify.channel_failed", { channel: "email", type: input.type, to, error: res.error });
    }),
  );
}

async function sendToUser(input: DispatchInput, user: Recipient, siteTimezone: string, now: Date): Promise<void> {
  const prefs: NotificationPrefs = parsePrefs(user.notificationPref?.prefs);
  const locale = user.locale ?? defaultLocale;
  const rendered = renderNotification(input.type, input.payload, locale);
  const message: ChannelMessage = { ...rendered, url: absoluteUrl(rendered.url), type: input.type, locale, siteId: input.siteId, payload: input.payload };
  const timeZone = prefs.timeZone ?? siteTimezone;
  const window = { quietFrom: user.notificationPref?.quietFrom ?? null, quietTo: user.notificationPref?.quietTo ?? null };
  if (!shouldDeliverNow(input.type, now, timeZone, window)) {
    log.info("notify.quiet", { type: input.type, userId: user.id });
    return;
  }
  if (EMAIL_ALWAYS_TYPES.has(input.type)) {
    await sendEmail(user, message);
    return;
  }
  let delivered = 0;
  if (user.pushSubscriptions.length && pushChannel.configured()) {
    const results = await Promise.all(user.pushSubscriptions.map((sub) => pushChannel.send(message, sub)));
    const dropped = user.pushSubscriptions.filter((_, i) => {
      const r = results[i];
      return r && !r.ok && r.dropped;
    });
    if (dropped.length) {
      await db.pushSubscription.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
      log.info("push.dropped", { userId: user.id, count: dropped.length });
    }
    delivered = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !("dropped" in r && r.dropped)).length;
    if (failed) log.warn("notify.channel_failed", { channel: "push", type: input.type, userId: user.id, failed });
  }
  const hasLiveSubscription = user.pushSubscriptions.length > 0 && delivered > 0;
  if (!hasLiveSubscription && prefs.emailFallback) await sendEmail(user, message);
}

/**
 * Delivers an already-stored notification through the channels. Never throws: every failure is logged.
 * Teams gets one card per event; push/email go per recipient, honoring quiet hours (`NotificationPref`).
 */
export async function dispatchChannels(input: DispatchInput): Promise<void> {
  const now = input.now ?? new Date();
  try {
    const site = input.siteId ? await db.site.findUnique({ where: { id: input.siteId }, select: { name: true, timezone: true } }) : null;
    const siteTimezone = site?.timezone ?? DEFAULT_TIMEZONE;
    const users: Recipient[] = input.userIds.length
      ? await db.user.findMany({
          where: { id: { in: input.userIds }, status: "active" },
          select: {
            id: true,
            email: true,
            name: true,
            locale: true,
            notificationPref: { select: { quietFrom: true, quietTo: true, prefs: true } },
            pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
          },
        })
      : [];
    const results = await Promise.allSettled([
      sendTeams(input, site?.name ?? null, now),
      sendExtraEmails(input),
      ...users.map((u) => sendToUser(input, u, siteTimezone, now)),
    ]);
    for (const r of results) {
      if (r.status === "rejected") log.error("notify.dispatch_failed", { type: input.type, err: String(r.reason) });
    }
  } catch (err) {
    log.error("notify.dispatch_failed", { type: input.type, err: String(err) });
  }
}
