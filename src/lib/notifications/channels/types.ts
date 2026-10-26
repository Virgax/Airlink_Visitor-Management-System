import type { NotificationType } from "@/lib/notifications/types";

/** One rendered notification, ready for any channel. `url` is absolute. */
export type ChannelMessage = {
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  locale: string;
  siteId: string | null;
  payload: Record<string, unknown>;
};

export type ChannelResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** The target is gone for good (e.g. push 404/410): the caller should forget it. */
      dropped?: boolean;
    };

/**
 * A delivery channel. `send` never throws: it returns `{ ok: false }` and the dispatcher logs it.
 * With NOTIFY_FAKE=1 every channel only records the message in `__fakeOutbox`.
 */
export interface Channel<Target> {
  readonly name: "push" | "teams" | "email";
  /** False when the required env vars are missing; the dispatcher then skips the channel silently. */
  configured(): boolean;
  send(message: ChannelMessage, target: Target): Promise<ChannelResult>;
}

/** Deep links leave the app as absolute URLs (push payloads, Teams cards, emails). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
