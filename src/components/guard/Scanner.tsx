"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Camera, CameraOff, CheckCircle2, CloudOff, KeyRound, LogOut, ShieldCheck, Wifi, WifiOff, XCircle } from "lucide-react";
import { Icon } from "@/components/Icon";
import { BadgePanel } from "@/components/guard/BadgePanel";
import type { KioskBadgeConfig } from "@/lib/badges/config";
import { fmtDate } from "@/lib/format";
import type { BadgeInfo, CheckpointInfo, ScanPassInfo, ScanReason, ScanResponse } from "@/lib/guard/types";
import { cacheIsFresh, provisionalCheck, type PassCache } from "@/lib/offline/provisional";
import { countQueuedScans, enqueueScan, flushQueue, loadPassCache, outcomeForStatus, savePassCache, type QueuedScan } from "@/lib/offline/queue";

const CACHE_REFRESH_MS = 5 * 60_000;
const SAME_PAYLOAD_DEBOUNCE_MS = 4_000;

type Tone = "ok" | "deny" | "left" | "provisional" | "verified";
type ResultView = {
  tone: Tone;
  reason?: ScanReason;
  pass?: Partial<ScanPassInfo> & { visitorName: string };
  conflict?: boolean;
  duplicate?: boolean;
  atDock?: boolean;
  at: string;
  badge?: BadgeInfo;
  checkpoint?: CheckpointInfo;
};

/** Minimal typing of the Shape Detection API (not in lib.dom yet). */
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function scanId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function postScan(scan: { payload: string; scanId: string; at: string; offline?: boolean }): Promise<Response> {
  return fetch("/api/guard/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scan) });
}

async function postPin(body: { pin: string; name?: string }): Promise<Response> {
  return fetch("/api/guard/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** `checkpoint`: verification-only gate — no PIN entry, no badge printing, no offline provisional entries. */
export function Scanner({ locale, timeZone, badgeConfig, checkpoint = false }: { locale: string; timeZone: string; badgeConfig: KioskBadgeConfig; checkpoint?: boolean }) {
  const t = useTranslations("guard");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ payload: string; at: number } | null>(null);
  const cacheRef = useRef<PassCache | null>(null);

  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; at: string } | null>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "error">("off");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [pin, setPin] = useState("");
  const [pinName, setPinName] = useState("");
  const [result, setResult] = useState<ResultView | null>(null);

  const refreshQueued = useCallback(async () => {
    try {
      setQueued(await countQueuedScans());
    } catch {
      /* IndexedDB unavailable (private mode) */
    }
  }, []);

  const applyCache = useCallback((cache: PassCache | null) => {
    cacheRef.current = cache;
    setCacheInfo(cache ? { count: cache.passes.length, at: cache.generatedAt } : null);
  }, []);

  const refreshCache = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await fetch("/api/guard/cache", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/guard";
        return;
      }
      if (!res.ok) return;
      const cache = (await res.json()) as PassCache;
      applyCache(cache);
      await savePassCache(cache).catch(() => undefined);
    } catch {
      /* offline: keep the stored copy */
    }
  }, [applyCache]);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await flushQueue(async (scan: QueuedScan) => outcomeForStatus((await postScan({ ...scan, offline: true })).status));
      if (res.sent.length) await refreshCache();
    } catch {
      /* try again on the next online event */
    }
    await refreshQueued();
  }, [refreshCache, refreshQueued]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      void flush();
      void refreshCache();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    loadPassCache().then((c) => applyCache(c)).catch(() => undefined);
    void refreshQueued();
    void refreshCache();
    void flush();
    const timer = window.setInterval(() => void refreshCache(), CACHE_REFRESH_MS);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [applyCache, flush, refreshCache, refreshQueued]);

  const showResponse = (data: ScanResponse | null, at: string) => {
    if (!data) {
      setResult({ tone: "deny", reason: "network", at });
      return;
    }
    if (!data.ok) {
      setResult({ tone: "deny", reason: data.reason, pass: data.pass, at });
      return;
    }
    if (data.action === "verified") {
      setResult({ tone: data.checkpoint.allowed ? "verified" : "deny", reason: data.checkpoint.allowed ? undefined : "area_not_allowed", pass: data.pass, checkpoint: data.checkpoint, at });
      return;
    }
    setResult({
      tone: data.action === "left" ? "left" : "ok",
      pass: data.pass,
      conflict: data.conflict,
      duplicate: data.duplicate,
      atDock: data.visit.status === "at_dock",
      at: data.action === "left" ? (data.visit.leftAt ?? at) : (data.visit.enteredAt ?? at),
          badge: data.badge,
    });
  };

  const offlineScan = useCallback(
    async (payload: string, id: string, at: string) => {
      if (checkpoint) {
        // A checkpoint answers "is this person inside?", which only the server knows.
        setResult({ tone: "deny", reason: "network", at });
        return;
      }
      const cache = cacheIsFresh(cacheRef.current) ? cacheRef.current : null;
      const check = provisionalCheck(cache, payload);
      if (!check.ok) {
        setResult({ tone: "deny", reason: check.reason, pass: check.pass ? { ...check.pass, warnings: check.pass.warnings as ScanPassInfo["warnings"] } : undefined, at });
        return;
      }
      await enqueueScan({ scanId: id, payload, at }).catch(() => undefined);
      if (cache) {
        const next = { ...cache, passes: cache.passes.map((p) => (p.id === check.pass.id ? { ...p, uses: p.uses + 1 } : p)) };
        applyCache(next);
        await savePassCache(next).catch(() => undefined);
      }
      await refreshQueued();
      setResult({ tone: "provisional", pass: { ...check.pass, warnings: check.pass.warnings as ScanPassInfo["warnings"] }, atDock: check.pass.kind === "carrier", at });
    },
    [applyCache, checkpoint, refreshQueued],
  );

  const submit = useCallback(
    async (raw: string) => {
      const payload = raw.trim();
      if (!payload || busy) return;
      const now = Date.now();
      if (lastRef.current && lastRef.current.payload === payload && now - lastRef.current.at < SAME_PAYLOAD_DEBOUNCE_MS) return;
      lastRef.current = { payload, at: now };
      const id = scanId();
      const at = new Date(now).toISOString();
      setBusy(true);
      try {
        if (!navigator.onLine) {
          await offlineScan(payload, id, at);
          return;
        }
        let res: Response;
        try {
          res = await postScan({ payload, scanId: id, at });
        } catch {
          await offlineScan(payload, id, at);
          return;
        }
        if (res.status === 401) {
          window.location.href = "/guard";
          return;
        }
        const data = (await res.json().catch(() => null)) as ScanResponse | null;
        showResponse(data, at);
        void flush();
      } finally {
        setBusy(false);
      }
    },
    [busy, flush, offlineScan],
  );

  /** PIN entry (online only): the server finds the pass and runs the same entry path as a scan. */
  const submitPin = useCallback(async () => {
    const digits = pin.replace(/\D/g, "");
    if (digits.length !== 6 || busy) return;
    const at = new Date().toISOString();
    setBusy(true);
    try {
      let res: Response;
      try {
        res = await postPin({ pin: digits, ...(pinName.trim() ? { name: pinName.trim() } : {}) });
      } catch {
        setResult({ tone: "deny", reason: "network", at });
        return;
      }
      if (res.status === 401) {
        window.location.href = "/guard";
        return;
      }
      const data = (await res.json().catch(() => null)) as ScanResponse | null;
      showResponse(data, at);
      if (data?.ok) {
        setPin("");
        setPinName("");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, pin, pinName]);

  const stopCamera = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setCamera("off");
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCamera("starting");
    try {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Detector) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        let scanning = false;
        const timer = window.setInterval(async () => {
          if (scanning || video.readyState < 2) return;
          scanning = true;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value) void submit(value);
          } catch {
            /* frame not ready */
          } finally {
            scanning = false;
          }
        }, 250);
        stopRef.current = () => {
          window.clearInterval(timer);
          stream.getTracks().forEach((tr) => tr.stop());
          video.srcObject = null;
        };
      } else {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(undefined, video, (res) => {
          if (res) void submit(res.getText());
        });
        stopRef.current = () => controls.stop();
      }
      setCamera("on");
    } catch {
      stopRef.current?.();
      stopRef.current = null;
      setCamera("error");
    }
  }, [submit]);

  useEffect(() => () => stopRef.current?.(), []);

  const toneClass: Record<Tone, string> = {
    ok: "border-success bg-success-bg text-success",
    verified: "border-success bg-success-bg text-success",
    provisional: "border-warning bg-warning-bg text-warning",
    left: "border-border bg-surface-2 text-text",
    deny: "border-danger bg-danger-bg text-danger",
  };
  const toneIcon: Record<Tone, typeof CheckCircle2> = { ok: CheckCircle2, verified: ShieldCheck, provisional: CloudOff, left: LogOut, deny: XCircle };
  const toneTitle = (r: ResultView) =>
    r.tone === "deny" ? (r.checkpoint ? t("scan.checkpointDenied") : t("scan.denied")) : r.tone === "verified" ? t("scan.verified") : r.tone === "left" ? t("scan.left") : r.tone === "provisional" ? t("scan.provisional") : r.atDock ? t("scan.atDock") : t("scan.entered");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="scan-status">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${online ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
              <Icon icon={online ? Wifi : WifiOff} size={14} /> {online ? t("scan.online") : t("scan.offline")}
            </span>
            <span className="muted">{t("scan.queued", { count: queued })}</span>
            <span className="muted">{cacheInfo ? t("scan.cacheAge", { count: cacheInfo.count, time: fmtDate(cacheInfo.at, locale, { timeZone, dateStyle: undefined, timeStyle: "short" }) }) : t("scan.cacheNone")}</span>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-hidden="true" />
            {camera !== "on" ? (
              <div className="absolute inset-0 flex items-center justify-center text-white/80">
                <Icon icon={camera === "error" ? CameraOff : Camera} size={40} />
              </div>
            ) : null}
          </div>
          {camera === "error" ? <p className="alert-error" role="alert">{t("scan.cameraUnavailable")}</p> : null}
          <button type="button" onClick={camera === "on" ? stopCamera : startCamera} disabled={camera === "starting"} className={camera === "on" ? "btn-secondary w-full" : "btn-primary w-full"}>
            <Icon icon={camera === "on" ? CameraOff : Camera} /> {camera === "on" ? t("scan.cameraStop") : t("scan.cameraStart")}
          </button>
        </div>
        <form
          className="card space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(manual).then(() => setManual(""));
          }}
        >
          <label className="label" htmlFor="manual-payload">{t("scan.manual")}</label>
          <div className="flex gap-2">
            <input id="manual-payload" name="payload" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t("scan.manualPlaceholder")} autoComplete="off" className="input font-mono" data-testid="manual-payload" />
            <button type="submit" className="btn-secondary" disabled={busy || !manual.trim()}>{t("scan.manualSubmit")}</button>
          </div>
        </form>
        {checkpoint ? null : (
        <form
          className="card space-y-2"
          data-testid="pin-entry"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPin();
          }}
        >
          <h2 className="font-medium"><Icon icon={KeyRound} /> {t("scan.pinTitle")}</h2>
          <p className="muted">{t("scan.pinHelp")}</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="label" htmlFor="pin-entry-pin">{t("scan.pin")}</label>
              <input id="pin-entry-pin" name="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" pattern="[0-9 -]{6,8}" maxLength={8} autoComplete="off" className="input font-mono text-lg tracking-widest" data-testid="pin-entry-pin" disabled={!online} />
            </div>
            <div>
              <label className="label" htmlFor="pin-entry-name">{t("scan.pinName")}</label>
              <input id="pin-entry-name" name="name" value={pinName} onChange={(e) => setPinName(e.target.value)} maxLength={120} autoComplete="off" className="input" disabled={!online} />
            </div>
            <div className="self-end">
              <button type="submit" className="btn-primary w-full" disabled={busy || !online || pin.replace(/\D/g, "").length !== 6}>{t("scan.pinSubmit")}</button>
            </div>
          </div>
          {!online ? <p className="muted">{t("scan.pinOffline")}</p> : null}
        </form>
        )}
      </div>

      <div aria-live="polite">
        {busy && !result ? <p className="muted">{t("scan.pending")}</p> : null}
        {result ? (
          <div className={`card border-2 ${toneClass[result.tone]}`} role="status" data-testid="scan-result" data-tone={result.tone} data-reason={result.reason ?? ""}>
            <div className="flex items-center gap-3">
              <Icon icon={toneIcon[result.tone]} size={44} />
              <div>
                <p className="text-2xl font-bold">{toneTitle(result)}</p>
                {result.reason ? <p className="text-base">{t(`reasons.${result.reason}`)}</p> : null}
                {result.duplicate ? <p className="text-sm">{t("scan.duplicate")}</p> : null}
                {result.conflict ? <p className="text-sm font-semibold">{t("scan.conflict")}</p> : null}
                {result.tone === "provisional" ? <p className="text-sm">{t("scan.provisionalHelp")}</p> : null}
              </div>
            </div>
            {result.pass ? (
              <dl className="mt-4 grid gap-x-4 gap-y-1 text-text sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="muted">{t("scan.visitor")}</dt>
                  <dd className="text-xl font-semibold" data-testid="result-name">{result.pass.visitorName}</dd>
                </div>
                <div>
                  <dt className="muted">{t("scan.company")}</dt>
                  <dd>{result.pass.company ?? "—"}</dd>
                </div>
                <div>
                  <dt className="muted">{t("scan.host")}</dt>
                  <dd>{result.pass.host ?? "—"}{result.pass.hostDepartment ? ` · ${result.pass.hostDepartment}` : ""}</dd>
                </div>
                <div>
                  <dt className="muted">{t("scan.areas")}</dt>
                  <dd>{result.pass.areas?.length ? result.pass.areas.join(", ") : "—"}</dd>
                </div>
                <div>
                  <dt className="muted">{t("scan.kind")}</dt>
                  <dd>{result.pass.kind ? t(`kinds.${result.pass.kind as "visit"}`) : "—"}{result.pass.docLast4 ? ` · ${t("scan.document")} ****${result.pass.docLast4}` : ""}{result.pass.plate ? ` · ${t("scan.plate")} ${result.pass.plate}` : ""}</dd>
                </div>
                {result.checkpoint ? (
                  <div className="sm:col-span-2" data-testid="result-checkpoint" data-allowed={result.checkpoint.allowed ? "1" : "0"}>
                    <dt className="muted">{t("scan.checkpointAreas")}</dt>
                    <dd>{result.checkpoint.controlledAreas.length ? result.checkpoint.controlledAreas.join(", ") : t("scan.checkpointAnyArea")}</dd>
                    {result.checkpoint.enteredAt ? <dd className="muted">{t("scan.enteredAt", { time: fmtDate(result.checkpoint.enteredAt, locale, { timeZone, dateStyle: undefined, timeStyle: "short" }) })}{result.checkpoint.badgeNo ? ` · ${t("scan.badgeNo", { badgeNo: result.checkpoint.badgeNo })}` : ""}</dd> : null}
                  </div>
                ) : null}
                {result.pass.answers?.length ? (
                  <div className="sm:col-span-2" data-testid="result-answers">
                    <dt className="muted">{t("scan.answers")}</dt>
                    <dd>
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {result.pass.answers.map((a) => (
                          <li key={a.id} className="whitespace-pre-wrap"><span className="muted">{a.label}:</span> {typeof a.value === "boolean" ? t(a.value ? "scan.yes" : "scan.no") : String(a.value)}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                {result.pass.warnings?.length ? (
                  <div className="sm:col-span-2">
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {result.pass.warnings.map((w) => (
                        <li key={w} className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-sm font-medium text-warning">
                          <Icon icon={AlertTriangle} size={14} /> {t(`warnings.${w}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <p className="muted mt-3">{fmtDate(result.at, locale, { timeZone })}</p>
            <button type="button" onClick={() => setResult(null)} className="btn-secondary mt-3">{t("scan.scanAgain")}</button>
          </div>
        ) : null}
        {result?.badge ? (
          <div className="mt-4">
            <BadgePanel key={result.badge.visitId} visitId={result.badge.visitId} config={badgeConfig} autoPrint={result.badge.autoPrint} onDone={() => setResult(null)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
