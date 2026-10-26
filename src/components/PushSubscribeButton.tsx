"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BellOff, BellRing } from "lucide-react";
import { Icon } from "@/components/Icon";

type State = "checking" | "unsupported" | "notConfigured" | "subscribed" | "unsubscribed" | "working" | "denied" | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * "Activar notificaciones en este dispositivo": registers the service worker, subscribes with the VAPID key from
 * `/api/push/public-key` and stores the subscription through `/api/push/subscribe` (DELETE to remove).
 */
export function PushSubscribeButton() {
  const t = useTranslations("notifications.push");
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported()) return setState("unsupported");
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "subscribed" : "unsubscribed");
      } catch {
        if (!cancelled) setState("unsubscribed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setState("working");
    try {
      const keyRes = await fetch("/api/push/public-key", { cache: "no-store" });
      if (keyRes.status === 404) return setState("notConfigured");
      if (!keyRes.ok) return setState("error");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState("denied");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) return setState("error");
      setState("subscribed");
    } catch {
      setState("error");
    }
  }, []);

  const disable = useCallback(async () => {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("error");
    }
  }, []);

  const message =
    state === "unsupported" ? t("unsupported")
    : state === "notConfigured" ? t("notConfigured")
    : state === "denied" ? t("denied")
    : state === "error" ? t("error")
    : state === "subscribed" ? t("enabled")
    : state === "working" ? t("working")
    : null;

  const canEnable = state === "unsubscribed" || state === "error" || state === "denied";
  return (
    <div className="space-y-3" data-testid="push-subscribe" data-state={state}>
      {message ? <p className={state === "subscribed" ? "alert-ok" : "muted"} role="status">{message}</p> : null}
      {state === "subscribed" ? (
        <button type="button" onClick={disable} className="btn-secondary">
          <Icon icon={BellOff} /> {t("disable")}
        </button>
      ) : canEnable ? (
        <button type="button" onClick={enable} className="btn-primary">
          <Icon icon={BellRing} /> {t("enable")}
        </button>
      ) : null}
    </div>
  );
}
