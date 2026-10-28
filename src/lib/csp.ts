import { BROWSER_PRINT_ORIGINS } from "@/lib/badges/config";

/**
 * Content-Security-Policy with a per-request nonce. Add new origins here only; never inline a policy elsewhere.
 * `browserPrint`: the kiosk's gate prints through Zebra Browser Print (`Gate.settings.printer.kind === "browser"`),
 * which listens on localhost:9100/9101 on the kiosk PC; the origin is added to connect-src only in that case
 * (the kiosk sign-in sets the `visitas_print` cookie the middleware reads).
 */
export function buildCsp(nonce: string, opts: { dev: boolean; browserPrint?: boolean }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (opts.dev) scriptSrc.push("'unsafe-eval'");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"].concat(opts.dev ? ["ws:"] : []).concat(opts.browserPrint ? BROWSER_PRINT_ORIGINS : []),
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
