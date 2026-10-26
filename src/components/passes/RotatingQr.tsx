"use client";

import { useEffect, useRef, useState } from "react";

type QrResponse = { payload: string; dataUrl: string; rotating: boolean; refreshInSec: number | null };

/**
 * Rotating QR for recurring passes: re-fetches `/api/v/<token>/qr` when the current step ends (every 30 s)
 * and whenever the page becomes visible again, so the visitor always shows a fresh code at the gate.
 */
export function RotatingQr({
  token,
  initial,
  labels,
}: {
  token: string;
  initial: { dataUrl: string; refreshInSec: number };
  labels: { alt: string; loading: string; offline: string };
}) {
  const [dataUrl, setDataUrl] = useState(initial.dataUrl);
  const [error, setError] = useState(false);
  // Each completed fetch bumps `round`, which re-arms the timer even when nothing else changed (e.g. repeated failures).
  const [round, setRound] = useState(0);
  const refreshIn = useRef(initial.refreshInSec);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/v/${encodeURIComponent(token)}/qr`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as QrResponse;
        if (cancelled) return;
        setDataUrl(json.dataUrl);
        refreshIn.current = json.refreshInSec ?? 30;
        setError(false);
      } catch {
        if (cancelled) return;
        setError(true);
        refreshIn.current = 10;
      }
      if (!cancelled) setRound((r) => r + 1);
    };
    const timer = setTimeout(load, Math.max(1, refreshIn.current) * 1000 + 300);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, round]);

  return (
    <div className="space-y-2 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated server side */}
      <img src={dataUrl} alt={labels.alt} width={288} height={288} className="mx-auto rounded-lg bg-white p-2" data-testid="pass-qr" data-rotating="true" />
      {error ? <p className="alert-error" role="alert">{labels.offline}</p> : null}
    </div>
  );
}
