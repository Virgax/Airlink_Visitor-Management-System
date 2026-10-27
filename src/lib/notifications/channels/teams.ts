import { log } from "@/lib/log";
import { isFakeMode, recordFake } from "@/lib/notifications/fake";
import { errorMessage, type Channel, type ChannelMessage, type ChannelResult } from "./types";

export type TeamsFact = { name: string; value: string };

/** Extra card content: facts (site, gate, host…) and the signed Approve/Deny links. */
export type TeamsTarget = {
  facts: TeamsFact[];
  labels: { approve: string; deny: string; openApp: string };
  actions?: { approveUrl: string; denyUrl: string };
};

const TIMEOUT_MS = 8_000;

function webhookUrl(): string | null {
  const url = process.env.TEAMS_WEBHOOK_URL;
  return url && /^https:\/\//.test(url) ? url : null;
}

/**
 * Adaptive Card (1.4) wrapped the way Power Automate's "When a Teams webhook request is received" flow expects
 * a `message` with attachments. Approve/Deny are `Action.OpenUrl` buttons to signed `/api/teams/action` links
 * (one-click from any Teams client; the page confirms with a POST so link previews never decide anything).
 */
export function buildAdaptiveCard(message: ChannelMessage, target: TeamsTarget): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: message.title, weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: message.body, wrap: true },
  ];
  if (target.facts.length) body.push({ type: "FactSet", facts: target.facts.map((f) => ({ title: f.name, value: f.value })) });
  const actions: Record<string, unknown>[] = [];
  if (target.actions) {
    actions.push({ type: "Action.OpenUrl", title: target.labels.approve, url: target.actions.approveUrl, style: "positive" });
    actions.push({ type: "Action.OpenUrl", title: target.labels.deny, url: target.actions.denyUrl, style: "destructive" });
  }
  actions.push({ type: "Action.OpenUrl", title: target.labels.openApp, url: message.url });
  return {
    type: "message",
    summary: message.title,
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body,
          actions,
        },
      },
    ],
    // Plain metadata for flows that prefer to build their own card or call the action endpoint directly.
    visitas: {
      type: message.type,
      siteId: message.siteId,
      url: message.url,
      actions: target.actions
        ? [
            { decision: "approved", method: "POST", url: target.actions.approveUrl },
            { decision: "denied", method: "POST", url: target.actions.denyUrl },
          ]
        : [],
    },
  };
}

/** Teams via Power Automate webhook (TEAMS_WEBHOOK_URL). One card per event, shared by the channel. */
export const teamsChannel: Channel<TeamsTarget> = {
  name: "teams",
  configured: () => isFakeMode() || webhookUrl() !== null,
  async send(message, target): Promise<ChannelResult> {
    const card = buildAdaptiveCard(message, target);
    if (isFakeMode()) {
      recordFake({
        channel: "teams",
        to: webhookUrl() ?? "teams-webhook",
        type: message.type,
        title: message.title,
        body: message.body,
        url: message.url,
        extra: { card, actions: target.actions ?? null },
      });
      return { ok: true };
    }
    const url = webhookUrl();
    if (!url) return { ok: false, error: "teams_not_configured" };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn("teams.failed", { status: res.status, type: message.type });
        return { ok: false, error: `http_${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      log.warn("teams.failed", { type: message.type, err: errorMessage(err) });
      return { ok: false, error: errorMessage(err) };
    }
  },
};
