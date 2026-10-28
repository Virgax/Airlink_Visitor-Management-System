/**
 * ZPL II rendering of the visitor badge: a 4" × 2" direct-thermal label on the Zebra ZP450 (203 dpi → 812 × 406 dots).
 * Pure: no database, no i18n lookups (labels arrive translated in `BadgeData`). Snapshot-tested in tests/zpl.test.ts.
 * Layout and printer facts: docs/BADGES.md.
 */

export const LABEL = { width: 812, height: 406, margin: 16 } as const;
export const BADGE_PHOTO = { width: 160, height: 200 } as const;

export const BADGE_TEMPLATES = ["landscape_photo", "landscape"] as const;
export type BadgeTemplate = (typeof BADGE_TEMPLATES)[number];
export const DEFAULT_BADGE_TEMPLATE: BadgeTemplate = "landscape_photo";

export function isBadgeTemplate(value: unknown): value is BadgeTemplate {
  return typeof value === "string" && (BADGE_TEMPLATES as readonly string[]).includes(value);
}

/** 1-bit bitmap, row-major, 8 pixels per byte (MSB = leftmost), rows padded to a whole byte, 1 = black. */
export type BadgePhoto = { width: number; height: number; bits: Uint8Array };

export type BadgeLabels = { host: string; entry: string; badge: string; doc: string };

export type BadgeData = {
  visitorName: string;
  company: string | null;
  hostName: string | null;
  areaNames: string[];
  /** Visit kind, already translated (printed upper-cased). */
  kindLabel: string;
  /** Entry date/time already formatted in the site's time zone and the kiosk language. */
  enteredAt: string;
  gateName: string;
  badgeNo: string;
  /** Translated warning texts (escort, NDA, reception only…). */
  warnings: string[];
  /** `visitId.sig`, see src/lib/badges/visitQr.ts */
  qrPayload: string;
  docLast4?: string | null;
  photo?: BadgePhoto | null;
  labels: BadgeLabels;
};

/** Maximum characters per line, chosen for the font sizes below and the free width next to the photo/QR. */
export const LIMITS = { kind: 40, name: 30, company: 36, line: 44, areas: 44, warnings: 90, badge: 24 } as const;

/** Text that is safe inside `^FD…^FS`: control characters and ZPL command prefixes removed, length capped. */
export function zplText(value: string | null | undefined, max: number): string {
  const clean = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\^~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean;
}

/** `^GFA` graphic field for a packed 1-bit bitmap (uppercase hex, uncompressed, on one line). */
export function bitmapToGfa(bits: Uint8Array, width: number, height: number): string {
  const bytesPerRow = Math.ceil(width / 8);
  const total = bytesPerRow * height;
  if (bits.length < total) throw new Error(`bitmapToGfa: expected ${total} bytes, got ${bits.length}`);
  let hex = "";
  for (let i = 0; i < total; i++) hex += bits[i]!.toString(16).padStart(2, "0").toUpperCase();
  return `^GFA,${total},${total},${bytesPerRow},${hex}`;
}

type Line = { x: number; y: number; size: number; width: number; text: string; lines?: number };

function field(l: Line): string {
  return `^FO${l.x},${l.y}^A0N,${l.size},${l.size}^FB${l.width},${l.lines ?? 1},0,L,0^FD${l.text}^FS`;
}

const QR = { x: 598, y: 196, magnification: 6 } as const;
const TEXT_RIGHT = LABEL.width - LABEL.margin; // 796
const QR_CLEAR = QR.x - 12; // text on the QR rows must stop here

/**
 * Renders the badge. `landscape_photo` reserves the left column for the photo (160 × 200 at the margin);
 * `landscape` ignores any photo and uses the full width for the text.
 */
export function renderBadgeZpl(data: BadgeData, template: BadgeTemplate = DEFAULT_BADGE_TEMPLATE): string {
  const photo = template === "landscape_photo" && data.photo ? data.photo : null;
  const left = template === "landscape_photo" ? LABEL.margin + BADGE_PHOTO.width + 20 : LABEL.margin;
  const wide = TEXT_RIGHT - left;
  const narrow = QR_CLEAR - left;
  const t = (v: string | null | undefined, max: number) => zplText(v, max);

  const out: string[] = ["^XA", "^CI28", "^MNY", `^PW${LABEL.width}`, `^LL${LABEL.height}`, "^LH0,0"];

  if (photo) out.push(`^FO${LABEL.margin},${LABEL.margin}${bitmapToGfa(photo.bits, photo.width, photo.height)}^FS`);

  out.push(field({ x: left, y: 16, size: 28, width: wide, text: t(data.kindLabel, LIMITS.kind).toUpperCase() }));
  out.push(field({ x: left, y: 48, size: 48, width: wide, text: t(data.visitorName, LIMITS.name) }));
  if (data.company) out.push(field({ x: left, y: 100, size: 32, width: wide, text: t(data.company, LIMITS.company) }));
  if (data.hostName) out.push(field({ x: left, y: 138, size: 26, width: narrow, text: t(`${data.labels.host}: ${data.hostName}`, LIMITS.line) }));
  out.push(field({ x: left, y: 168, size: 26, width: narrow, text: t(`${data.labels.entry}: ${data.enteredAt} · ${data.gateName}`, LIMITS.line) }));
  if (data.areaNames.length) out.push(field({ x: left, y: 198, size: 26, width: narrow, text: t(data.areaNames.join(", "), LIMITS.areas) }));

  const warnings = data.warnings.map((w) => t(w, 30).toUpperCase()).filter(Boolean);
  if (warnings.length) out.push(field({ x: LABEL.margin, y: 236, size: 30, width: QR_CLEAR - LABEL.margin, lines: 2, text: t(warnings.join(" · "), LIMITS.warnings) }));

  const badgeLine = [`${data.labels.badge} #${data.badgeNo}`, data.docLast4 ? `${data.labels.doc} ****${data.docLast4}` : null].filter(Boolean).join(" · ");
  out.push(field({ x: LABEL.margin, y: 340, size: 36, width: QR_CLEAR - LABEL.margin, text: t(badgeLine, LIMITS.badge + 24) }));

  out.push(`^FO${QR.x},${QR.y}^BQN,2,${QR.magnification}^FDMA,${t(data.qrPayload, 120)}^FS`);
  out.push("^PQ1", "^XZ");
  return out.join("\n");
}
