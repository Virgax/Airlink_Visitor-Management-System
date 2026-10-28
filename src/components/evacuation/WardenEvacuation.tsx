"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardCheck, Printer, RefreshCw, RotateCcw } from "lucide-react";
import { Icon } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import type { WardenSnapshot } from "@/lib/server/evacuation";
import { loadRollCall, loadWardenSnapshot, saveRollCall, saveWardenSnapshot } from "@/lib/offline/warden";

/**
 * The wardens' list: the server snapshot is written to IndexedDB on every load; offline the stored copy is shown
 * with its "last update" stamp. Roll call keeps a set of counted ids (per snapshot) on the device only.
 */
export function WardenEvacuation({ initial, locale }: { initial: WardenSnapshot; locale: string }) {
  const t = useTranslations("people.evacuation");
  const [snapshot, setSnapshot] = useState<WardenSnapshot>(initial);
  const [fromCache, setFromCache] = useState(false);
  const [rollCall, setRollCall] = useState(false);
  const [counted, setCounted] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadWardenSnapshot();
        if (navigator.onLine) {
          await saveWardenSnapshot(initial);
        } else if (stored && !cancelled && stored.generatedAt > initial.generatedAt) {
          setSnapshot(stored);
          setFromCache(true);
        } else if (!cancelled) {
          setFromCache(true);
        }
        const roll = await loadRollCall();
        if (roll && !cancelled) {
          setRollCall(roll.active);
          setCounted(new Set(roll.counted));
        }
      } catch {
        /* IndexedDB unavailable */
      }
    })();
    const down = () => setFromCache(true);
    window.addEventListener("offline", down);
    return () => {
      cancelled = true;
      window.removeEventListener("offline", down);
    };
  }, [initial]);

  const persistRoll = useCallback((active: boolean, ids: Set<string>) => {
    void saveRollCall({ active, counted: [...ids] }).catch(() => undefined);
  }, []);

  const toggleRollCall = () => {
    const next = !rollCall;
    setRollCall(next);
    persistRoll(next, counted);
  };
  const toggleCounted = (id: string) => {
    const next = new Set(counted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCounted(next);
    persistRoll(rollCall, next);
  };
  const resetCount = () => {
    const empty = new Set<string>();
    setCounted(empty);
    persistRoll(rollCall, empty);
  };

  const allIds = useMemo(() => snapshot.sites.flatMap((s) => s.groups.flatMap((g) => g.people.map((p) => p.id))), [snapshot]);
  const total = allIds.length;
  const countedTotal = allIds.filter((id) => counted.has(id)).length;
  const time = (iso: string, tz: string) => fmtDate(iso, locale, { timeZone: tz, dateStyle: undefined, timeStyle: "short" });
  const tz = snapshot.sites[0]?.timeZone ?? "America/Santo_Domingo";

  return (
    <div data-testid="warden-evacuation">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-xl font-semibold" data-testid="warden-count">{t("count", { count: total })}</p>
        <p className="muted" data-testid="warden-updated">{t("lastUpdate", { time: fmtDate(snapshot.generatedAt, locale, { timeZone: tz }) })}</p>
        <div className="print-hidden ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.reload()} className="btn-secondary"><Icon icon={RefreshCw} /> {t("refresh")}</button>
          <button type="button" onClick={toggleRollCall} className={rollCall ? "btn-primary" : "btn-secondary"} data-testid="roll-call-toggle" aria-pressed={rollCall}>
            <Icon icon={ClipboardCheck} /> {rollCall ? t("rollCallOn") : t("rollCall")}
          </button>
          <button type="button" onClick={() => window.print()} className="btn-secondary"><Icon icon={Printer} /> {t("print")}</button>
        </div>
      </div>
      {fromCache ? <p className="alert-error print-hidden mb-4" role="status">{t("offline")}</p> : null}
      {rollCall ? (
        <div className="alert-ok print-hidden mb-4 flex flex-wrap items-center gap-3" role="status">
          <span className="font-semibold" data-testid="roll-call-counted">{t("counted", { count: countedTotal, total })}</span>
          <span className="text-xs">{t("rollCallHelp")}</span>
          <button type="button" onClick={resetCount} className="btn-secondary ml-auto text-sm"><Icon icon={RotateCcw} /> {t("reset")}</button>
        </div>
      ) : null}
      {total === 0 ? <p className="muted">{t("empty")}</p> : null}
      <div className="space-y-6">
        {snapshot.sites.map((site) => (
          <section key={site.siteId} data-testid={`evacuation-site-${site.siteId}`}>
            {snapshot.sites.length > 1 ? <h2 className="mb-2 text-lg font-semibold">{site.siteName} <span className="muted font-normal">({site.total})</span></h2> : null}
            {site.groups.length === 0 ? <p className="muted">{t("empty")}</p> : null}
            <div className="space-y-4">
              {site.groups.map((g) => (
                <div key={`${g.kind}-${g.area}`} className="card break-inside-avoid">
                  <h3 className="mb-2 font-semibold">{g.kind === "employees" ? t("employees") : `${t("visitors")} · ${g.area}`} <span className="muted font-normal">({g.people.length})</span></h3>
                  <ul className="divide-y divide-border">
                    {g.people.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2" data-testid="evacuation-person">
                        {rollCall ? (
                          <input type="checkbox" checked={counted.has(p.id)} onChange={() => toggleCounted(p.id)} aria-label={t("countedLabel", { name: p.name })} className="h-5 w-5" />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium ${rollCall && counted.has(p.id) ? "line-through opacity-60" : ""}`}>{p.name}{p.detail ? <span className="muted font-normal"> · {p.detail}</span> : null}</p>
                          <p className="muted">{p.host ? `${g.kind === "employees" ? "" : `${t("host")}: `}${p.host} · ` : ""}{t("since", { time: time(p.since, site.timeZone) })}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
