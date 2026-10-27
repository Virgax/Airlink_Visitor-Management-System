import { log } from "@/lib/log";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * NOTIFY_FAKE=1: nothing leaves the process. Channels log `notify.fake` and append what they would have sent
 * here so tests can assert on it. Only meant for tests and local development.
 */
export type FakeOutboxEntry = {
  channel: "push" | "teams" | "email";
  /** Push endpoint, email address or the webhook host. */
  to: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  at: Date;
  extra?: Record<string, unknown>;
};

const MAX_ENTRIES = 500;

export const __fakeOutbox: FakeOutboxEntry[] = [];

export function isFakeMode(): boolean {
  return process.env.NOTIFY_FAKE === "1";
}

export function recordFake(entry: Omit<FakeOutboxEntry, "at">): void {
  __fakeOutbox.push({ ...entry, at: new Date() });
  if (__fakeOutbox.length > MAX_ENTRIES) __fakeOutbox.splice(0, __fakeOutbox.length - MAX_ENTRIES);
  log.info("notify.fake", { channel: entry.channel, to: entry.to, type: entry.type, title: entry.title, url: entry.url });
}

export function clearFakeOutbox(): void {
  __fakeOutbox.length = 0;
}
