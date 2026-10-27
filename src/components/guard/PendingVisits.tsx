"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, LogIn, X } from "lucide-react";
import { Icon } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import type { VisitJson } from "@/lib/server/visits";

const POLL_MS = 4_000;

type Action = "approve_in_person" | "deny" | "enter";

/** Unannounced visits waiting at the gate, polled every 4 s, with the guard's override buttons. */
export function PendingVisits({ initial, locale, timeZone }: { initial: VisitJson[]; locale: string; timeZone: string }) {
  const t = useTranslations("guard");
  const [visits, setVisits] = useState<VisitJson[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/guard/visits?status=pending", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/guard";
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { visits: VisitJson[] };
      setVisits(data.visits);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (visitId: string, action: Action) => {
    setBusy(visitId);
    try {
      const res = await fetch("/api/guard/visits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitId, action }) });
      if (!res.ok) setError(true);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (visits.length === 0) return <p className="muted" data-testid="pending-empty">{t("unannounced.empty")}</p>;

  return (
    <ul className="space-y-3" data-testid="pending-list">
      {error ? <li className="alert-error">{t("reasons.network")}</li> : null}
      {visits.map((v) => (
        <li key={v.id} className={`rounded-lg border border-border p-3 ${v.status === "denied" ? "opacity-60" : ""}`} data-testid="pending-visit" data-status={v.status}>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{v.visitorName}</p>
              <p className="muted">{[v.company, t(`kinds.${v.kind as "visit"}`)].filter(Boolean).join(" · ")}{v.host ? ` · ${t("scan.host")}: ${v.host}` : ""}</p>
              <p className="muted text-xs">{t("unannounced.since", { time: fmtDate(v.createdAt, locale, { timeZone, dateStyle: undefined, timeStyle: "short" }) })}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.status === "approved" ? "bg-success-bg text-success" : v.status === "denied" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning"}`}>
              {t(`status.${v.status as "pending"}`)}
            </span>
          </div>
          {v.status !== "denied" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {v.status === "pending" ? (
                <button type="button" className="btn-primary" disabled={busy === v.id} onClick={() => void act(v.id, "approve_in_person")}>
                  <Icon icon={Check} /> {t("unannounced.approveInPerson")}
                </button>
              ) : (
                <button type="button" className="btn-primary" disabled={busy === v.id} onClick={() => void act(v.id, "enter")}>
                  <Icon icon={LogIn} /> {t("unannounced.enter")}
                </button>
              )}
              <button type="button" className="btn-secondary" disabled={busy === v.id} onClick={() => void act(v.id, "deny")}>
                <Icon icon={X} /> {t("unannounced.deny")}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
