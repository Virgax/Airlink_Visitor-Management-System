"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Icon } from "@/components/Icon";

export type SignatureLabels = { draw: string; clear: string; typedName: string; typedNameHelp: string; drawn: string };

/**
 * Drawn signature for the NDA: a canvas whose PNG (data URL) travels in the hidden `signature` input.
 * The typed full name stays as the fallback (small screens, no pointer); the server accepts either.
 */
export function SignaturePad({ idPrefix = "", labels, preview = false }: { idPrefix?: string; labels: SignatureLabels; preview?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState("");
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = 160;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111111";
      setDataUrl("");
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const point = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const start = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (preview) return;
    drawing.current = true;
    last.current = point(ev);
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const move = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = ev.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(ev);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try {
      setDataUrl(ev.currentTarget.toDataURL("image/png"));
    } catch {
      setDataUrl("");
    }
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setDataUrl("");
  };

  return (
    <div className="space-y-2" data-testid="signature-pad">
      <input type="hidden" name="signature" value={dataUrl} />
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border border-border bg-white"
        aria-label={labels.draw}
        role="img"
        data-testid="signature-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="muted">{dataUrl ? labels.drawn : labels.draw}</p>
        <button type="button" className="btn-secondary text-sm" onClick={clear}><Icon icon={Eraser} /> {labels.clear}</button>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}name`}>{labels.typedName}</label>
        <input id={`${idPrefix}name`} name="name" minLength={3} maxLength={120} className="input" autoComplete="name" required={!dataUrl && !preview} />
        <p className="muted mt-1">{labels.typedNameHelp}</p>
      </div>
    </div>
  );
}
