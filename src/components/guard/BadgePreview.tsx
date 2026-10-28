"use client";

import { useEffect, useRef, useState } from "react";
import { BADGE_PHOTO, LABEL, LIMITS, zplText, type BadgeData, type BadgeTemplate } from "@/lib/badges/zpl";

export type PreviewData = Omit<BadgeData, "photo">;

/**
 * On-screen rendering of the label with the same `BadgeData` the ZPL uses: 812 × 406 "dots" laid out at 1 px per dot
 * and scaled to the container width. Positions mirror `renderBadgeZpl` so what the guard sees is what prints.
 */
export function BadgePreview({ data, template, qrSvg, photoSrc, testId = "badge-preview" }: { data: PreviewData; template: BadgeTemplate; qrSvg: string | null; photoSrc: string | null; testId?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / LABEL.width));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const withPhoto = template === "landscape_photo";
  const left = withPhoto ? LABEL.margin + BADGE_PHOTO.width + 20 : LABEL.margin;
  const wide = LABEL.width - LABEL.margin - left;
  const narrow = 586 - left;
  const t = (v: string | null | undefined, max: number) => zplText(v, max);
  const line = (y: number, size: number, width: number, text: string, extra: React.CSSProperties = {}) => (
    <div style={{ position: "absolute", left, top: y, width, height: size + 4, fontSize: size, lineHeight: `${size + 2}px`, whiteSpace: "nowrap", overflow: "hidden", ...extra }}>{text}</div>
  );
  const warnings = data.warnings.map((w) => t(w, 30).toUpperCase()).filter(Boolean);
  const badgeLine = [`${data.labels.badge} #${data.badgeNo}`, data.docLast4 ? `${data.labels.doc} ****${data.docLast4}` : null].filter(Boolean).join(" · ");

  return (
    <div ref={wrapRef} className="w-full" style={{ height: LABEL.height * scale }} data-testid={testId}>
      <div
        className="relative overflow-hidden rounded border border-border bg-white font-sans font-bold text-black"
        style={{ width: LABEL.width, height: LABEL.height, transform: `scale(${scale})`, transformOrigin: "top left" }}
        aria-label={`${data.labels.badge} ${data.badgeNo}`}
      >
        {withPhoto ? (
          <div style={{ position: "absolute", left: LABEL.margin, top: LABEL.margin, width: BADGE_PHOTO.width, height: BADGE_PHOTO.height }} className="overflow-hidden bg-white">
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- raw 1-bit preview, no optimization wanted
              <img src={photoSrc} alt="" width={BADGE_PHOTO.width} height={BADGE_PHOTO.height} style={{ imageRendering: "pixelated" }} />
            ) : (
              <div className="h-full w-full border border-dashed border-neutral-400" />
            )}
          </div>
        ) : null}
        {line(16, 28, wide, t(data.kindLabel, LIMITS.kind).toUpperCase())}
        {line(48, 48, wide, t(data.visitorName, LIMITS.name))}
        {data.company ? line(100, 32, wide, t(data.company, LIMITS.company)) : null}
        {data.hostName ? line(138, 26, narrow, t(`${data.labels.host}: ${data.hostName}`, LIMITS.line)) : null}
        {line(168, 26, narrow, t(`${data.labels.entry}: ${data.enteredAt} · ${data.gateName}`, LIMITS.line))}
        {data.areaNames.length ? line(198, 26, narrow, t(data.areaNames.join(", "), LIMITS.areas)) : null}
        {warnings.length ? (
          <div style={{ position: "absolute", left: LABEL.margin, top: 236, width: 586 - LABEL.margin, fontSize: 30, lineHeight: "32px", maxHeight: 66, overflow: "hidden" }}>{t(warnings.join(" · "), LIMITS.warnings)}</div>
        ) : null}
        <div style={{ position: "absolute", left: LABEL.margin, top: 340, width: 586 - LABEL.margin, fontSize: 36, lineHeight: "38px", whiteSpace: "nowrap", overflow: "hidden" }} data-testid="badge-no">
          {t(badgeLine, LIMITS.badge + 24)}
        </div>
        {qrSvg ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`} alt="" width={198} height={198} style={{ position: "absolute", left: 598, top: 196 }} />
        ) : null}
      </div>
    </div>
  );
}
