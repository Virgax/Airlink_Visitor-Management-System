"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Icon } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import { loadEvacuation, saveEvacuation, type EvacuationSnapshot } from "@/lib/offline/queue";

/**
 * Printable evacuation list. The server-rendered snapshot is stored in IndexedDB; when the kiosk is offline the
 * newer of the two copies is shown (the page itself comes from the service worker's runtime cache).
 */
export function EvacuationList({ initial, locale, timeZone }: { initial: EvacuationSnapshot; locale: string; timeZone: string }) {
  const t = useTranslations("guard.evacuation");
  const [snapshot, setSnapshot] = useState<EvacuationSnapshot>(initial);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadEvacuation();
        if (navigator.onLine) {
          await saveEvacuation(initial);
          return;
        }
        if (stored && !cancelled && stored.generatedAt > initial.generatedAt) {
          setSnapshot(stored);
          setFromCache(true);
        } else if (!cancelled) {
          setFromCache(true);
        }
      } catch {
        /* IndexedDB unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const time = (iso: string) => fmtDate(iso, locale, { timeZone, dateStyle: undefined, timeStyle: "short" });

  return (
    <div data-testid="evacuation">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-xl font-semibold" data-testid="evacuation-count">{t("count", { count: snapshot.total })}</p>
        <p className="muted">{snapshot.siteName} · {t("generatedAt", { time: fmtDate(snapshot.generatedAt, locale, { timeZone }) })}</p>
        <button type="button" onClick={() => window.print()} className="btn-primary print-hidden ml-auto">
          <Icon icon={Printer} /> {t("print")}
        </button>
      </div>
      {fromCache ? <p className="alert-error print-hidden mb-4" role="status">{t("offlineCopy")}</p> : null}
      {snapshot.groups.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {snapshot.groups.map((g) => (
            <section key={g.area} className="card break-inside-avoid">
              <h2 className="mb-2 text-lg font-semibold">{g.area} <span className="muted font-normal">({g.visits.length})</span></h2>
              <table className="w-full text-left text-sm">
                <thead className="muted">
                  <tr>
                    <th className="py-1 pr-2 font-medium">{t("visitor")}</th>
                    <th className="py-1 pr-2 font-medium">{t("host")}</th>
                    <th className="py-1 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {g.visits.map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="py-1 pr-2 font-medium">{v.visitorName}{v.company ? <span className="muted font-normal"> · {v.company}</span> : null}</td>
                      <td className="py-1 pr-2">{v.host ?? "—"}</td>
                      <td className="muted py-1">{t("since", { time: time(v.enteredAt) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
