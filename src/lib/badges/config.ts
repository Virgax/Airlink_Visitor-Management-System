/**
 * Badge settings stored as JSON on `Site.settings.badgeTemplate` and `Gate.settings.printer`.
 * No server-only imports: the kiosk client components use these types and readers.
 */
import { DEFAULT_BADGE_TEMPLATE, isBadgeTemplate, type BadgeTemplate } from "@/lib/badges/zpl";

export const PRINTER_KINDS = ["agent", "browser"] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

/** `agent`: tools/print-agent polls the queue for this gate. `browser`: Zebra Browser Print on the kiosk PC. */
export type PrinterConfig = { kind: PrinterKind; name: string };

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readBadgeTemplate(siteSettings: unknown): BadgeTemplate {
  const v = obj(siteSettings).badgeTemplate;
  return isBadgeTemplate(v) ? v : DEFAULT_BADGE_TEMPLATE;
}

export function readPrinter(gateSettings: unknown): PrinterConfig | null {
  const p = obj(obj(gateSettings).printer);
  const kind = p.kind;
  if (kind !== "agent" && kind !== "browser") return null;
  const name = typeof p.name === "string" ? p.name.trim() : "";
  return { kind, name };
}

/** What the kiosk needs to know to print: template, printer and whether the photo step is available. */
export type KioskBadgeConfig = { template: BadgeTemplate; printer: PrinterConfig | null; photoEnabled: boolean };

/** Zebra Browser Print listens on the kiosk PC itself. Added to the CSP only when a gate uses `kind: "browser"`. */
export const BROWSER_PRINT_ORIGINS = ["http://localhost:9100", "https://localhost:9101"] as const;
