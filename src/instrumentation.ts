export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV, tracesSampleRate: 0.05 });
  }
}

export async function onRequestError(...args: unknown[]) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  // @ts-expect-error forwarded as-is
  return Sentry.captureRequestError(...args);
}
