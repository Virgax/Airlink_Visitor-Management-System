"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, CameraOff, Check, Download, Printer, RefreshCw, SkipForward } from "lucide-react";
import { Icon } from "@/components/Icon";
import { BadgePreview, type PreviewData } from "@/components/guard/BadgePreview";
import type { KioskBadgeConfig } from "@/lib/badges/config";
import { BADGE_PHOTO, bitmapToRgba, ditherToBadgePhoto } from "@/lib/badges/dither";
import type { BadgePhoto, BadgeTemplate } from "@/lib/badges/zpl";

type BadgeResponse = { ok: true; badge: { visitId: string; template: BadgeTemplate; hasPhoto: boolean; photoKey: string | null; data: PreviewData; qrSvg: string } } | { ok: false; error: string };

type Phase = "loading" | "photo" | "preview" | "error";
type PrintState = { status: "idle" | "printing" | "sent" | "downloaded" | "error"; reason?: "browser" | "agent" | "network" };

const BROWSER_PRINT = "http://localhost:9100";

export type BadgePanelProps = {
  visitId: string;
  config: KioskBadgeConfig;
  /** Print as soon as the preview is ready (policy `autoPrintBadge`). */
  autoPrint?: boolean;
  /** Reprint from the inside list: no photo step, audited as `badge.reprinted`. */
  reprint?: boolean;
  onDone?: () => void;
  doneHref?: string;
};

/**
 * "Gafete" step after a green scan or an in-person approval: optional photo (camera → 160 × 200 → Floyd–Steinberg →
 * 1-bit PNG uploaded to the server), on-screen preview of the exact label, and printing through the gate's printer
 * (print agent queue, Zebra Browser Print, or a .zpl download when the gate has none).
 */
export function BadgePanel({ visitId, config, autoPrint = false, reprint = false, onDone, doneHref }: BadgePanelProps) {
  const t = useTranslations("badges.panel");
  const [phase, setPhase] = useState<Phase>("loading");
  const [badge, setBadge] = useState<Extract<BadgeResponse, { ok: true }>["badge"] | null>(null);
  const [photo, setPhoto] = useState<{ bitmap: BadgePhoto; dataUrl: string } | null>(null);
  const [photoStored, setPhotoStored] = useState<boolean | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "error">("starting");
  const [print, setPrint] = useState<PrintState>({ status: "idle" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRef = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // 1. Load the badge data (assigns the number on first call).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/guard/badges/${encodeURIComponent(visitId)}`, { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/guard";
          return;
        }
        const data = (await res.json().catch(() => null)) as BadgeResponse | null;
        if (cancelled) return;
        if (!data || !data.ok) {
          setPhase("error");
          return;
        }
        setBadge(data.badge);
        setPhase(config.photoEnabled && !reprint && !data.badge.hasPhoto ? "photo" : "preview");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visitId, config.photoEnabled, reprint]);

  // 2. Camera for the photo step.
  useEffect(() => {
    if (phase !== "photo") return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCamera("on");
      } catch {
        if (!cancelled) setCamera("error");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [phase, stopCamera]);

  const uploadPhoto = useCallback(
    async (bitmap: BadgePhoto) => {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(new ImageData(bitmapToRgba(bitmap), bitmap.width, bitmap.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      try {
        const res = await fetch(`/api/guard/badges/${encodeURIComponent(visitId)}/photo`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
        setPhotoStored(res.ok);
      } catch {
        setPhotoStored(false);
      }
    },
    [visitId],
  );

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement("canvas");
    canvas.width = BADGE_PHOTO.width;
    canvas.height = BADGE_PHOTO.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Cover crop: keep the aspect ratio and center the face area.
    const scale = Math.max(BADGE_PHOTO.width / video.videoWidth, BADGE_PHOTO.height / video.videoHeight);
    const sw = BADGE_PHOTO.width / scale;
    const sh = BADGE_PHOTO.height / scale;
    ctx.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, BADGE_PHOTO.width, BADGE_PHOTO.height);
    const rgba = ctx.getImageData(0, 0, BADGE_PHOTO.width, BADGE_PHOTO.height).data;
    const bitmap = ditherToBadgePhoto(rgba, BADGE_PHOTO.width, BADGE_PHOTO.height);
    ctx.putImageData(new ImageData(bitmapToRgba(bitmap), bitmap.width, bitmap.height), 0, 0);
    setPhoto({ bitmap, dataUrl: canvas.toDataURL("image/png") });
    stopCamera();
    setPhase("preview");
    void uploadPhoto(bitmap);
  }, [stopCamera, uploadPhoto]);

  const retake = () => {
    setPhoto(null);
    setPhotoStored(null);
    setCamera("starting");
    setPhase("photo");
  };

  // 3. Printing through the gate's printer.
  const doPrint = useCallback(async () => {
    if (!badge) return;
    setPrint({ status: "printing" });
    const zplUrl = (via: string) => `/api/guard/badges/${encodeURIComponent(visitId)}/zpl?via=${via}${reprint ? "&reprint=1" : ""}`;
    try {
      if (config.printer?.kind === "agent") {
        const res = await fetch("/api/print/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitId, reprint }) });
        setPrint(res.ok ? { status: "sent" } : { status: "error", reason: "agent" });
        return;
      }
      if (config.printer?.kind === "browser") {
        const zpl = await (await fetch(zplUrl("browser"), { cache: "no-store" })).text();
        try {
          const device = await (await fetch(`${BROWSER_PRINT}/default?type=printer`)).json();
          const res = await fetch(`${BROWSER_PRINT}/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device, data: zpl }) });
          setPrint(res.ok ? { status: "sent" } : { status: "error", reason: "browser" });
        } catch {
          setPrint({ status: "error", reason: "browser" });
        }
        return;
      }
      // No printer on this gate: hand the ZPL to the guard as a file (drag it to the Zebra printer share).
      const res = await fetch(zplUrl("download"), { cache: "no-store" });
      if (!res.ok) throw new Error("zpl");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `badge-${badge.data.badgeNo}.zpl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setPrint({ status: "downloaded" });
    } catch {
      setPrint({ status: "error", reason: "network" });
    }
  }, [badge, config.printer, reprint, visitId]);

  useEffect(() => {
    if (phase === "preview" && autoPrint && badge && !autoRef.current) {
      autoRef.current = true;
      void doPrint();
    }
  }, [phase, autoPrint, badge, doPrint]);

  const photoSrc = photo?.dataUrl ?? (badge?.photoKey ? `/api/media/${badge.photoKey}` : null);

  return (
    <section className="card space-y-3" data-testid="badge-panel" data-phase={phase} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{reprint ? t("reprintTitle") : t("title")}</h2>
        {badge ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-sm font-mono" data-testid="badge-number">{badge.data.badgeNo}</span> : null}
      </div>

      {phase === "loading" ? <p className="muted">{t("loading")}</p> : null}
      {phase === "error" ? <p className="alert-error" role="alert">{t("loadError")}</p> : null}

      {phase === "photo" ? (
        <div className="space-y-3">
          <p className="muted">{t("photoIntro")}</p>
          <div className="relative mx-auto aspect-[4/5] w-48 overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-hidden="true" />
            {camera !== "on" ? (
              <div className="absolute inset-0 flex items-center justify-center text-white/80">
                <Icon icon={camera === "error" ? CameraOff : Camera} size={36} />
              </div>
            ) : null}
          </div>
          {camera === "error" ? <p className="alert-error" role="alert">{t("cameraUnavailable")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={takePhoto} disabled={camera !== "on"}>
              <Icon icon={Camera} /> {t("take")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { stopCamera(); setPhase("preview"); }} data-testid="badge-skip-photo">
              <Icon icon={SkipForward} /> {t("skip")}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "preview" && badge ? (
        <div className="space-y-3">
          <BadgePreview data={badge.data} template={badge.template} qrSvg={badge.qrSvg} photoSrc={badge.template === "landscape_photo" ? photoSrc : null} />
          {photoStored === false ? <p className="alert-error" role="alert">{t("photoNotStored")}</p> : null}
          {print.status === "sent" ? <p className="alert-ok" role="status">{t("sent")}</p> : null}
          {print.status === "downloaded" ? <p className="alert-ok" role="status">{t("downloaded")}</p> : null}
          {print.status === "error" ? <p className="alert-error" role="alert">{t(print.reason === "browser" ? "browserError" : print.reason === "agent" ? "agentError" : "printError")}</p> : null}
          {autoPrint && print.status === "printing" ? <p className="muted">{t("autoPrinted")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void doPrint()} disabled={print.status === "printing"} data-testid="badge-print">
              <Icon icon={config.printer ? Printer : Download} /> {print.status === "printing" ? t("printing") : print.status === "idle" ? t("print") : t("printAgain")}
            </button>
            {config.photoEnabled && !reprint ? (
              <button type="button" className="btn-secondary" onClick={retake}>
                <Icon icon={RefreshCw} /> {photo ? t("retake") : t("addPhoto")}
              </button>
            ) : null}
            {onDone ? (
              <button type="button" className="btn-secondary" onClick={onDone} data-testid="badge-done">
                <Icon icon={Check} /> {t("done")}
              </button>
            ) : doneHref ? (
              <Link href={doneHref} className="btn-secondary" data-testid="badge-done">
                <Icon icon={Check} /> {t("done")}
              </Link>
            ) : null}
          </div>
          {!config.printer ? <p className="muted">{t("noPrinter")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
