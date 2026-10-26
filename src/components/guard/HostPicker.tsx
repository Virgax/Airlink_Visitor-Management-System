"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UserCheck } from "lucide-react";
import { Icon } from "@/components/Icon";
import type { EmployeeHit } from "@/lib/guard/types";

/** Host search for the unannounced-visit form: calls a server action, keeps the choice in a hidden input. */
export function HostPicker({ search }: { search: (q: string) => Promise<EmployeeHit[]> }) {
  const t = useTranslations("guard.unannounced");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EmployeeHit | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await search(q);
        if (!cancelled) setHits(res);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, search]);

  return (
    <div>
      <input type="hidden" name="hostEmployeeId" value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2" data-testid="host-selected">
          <Icon icon={UserCheck} />
          <div className="min-w-0 flex-1">
            <p className="muted text-xs">{t("hostSelected")}</p>
            <p className="font-medium">{selected.name}{selected.department ? ` · ${selected.department}` : ""}</p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={() => setSelected(null)}>{t("hostChange")}</button>
        </div>
      ) : (
        <>
          <label className="label" htmlFor="hostSearch">{t("host")}</label>
          <input id="hostSearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hostPlaceholder")} autoComplete="off" className="input" aria-describedby="host-help" />
          <p id="host-help" className="muted mt-1 text-xs">{t("hostSearch")}</p>
          {q.trim().length >= 2 ? (
            <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-border" data-testid="host-results">
              {searching && hits.length === 0 ? <li className="muted px-3 py-2">{t("hostSearching")}</li> : null}
              {!searching && hits.length === 0 ? <li className="muted px-3 py-2">{t("hostNone")}</li> : null}
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setSelected(h); setQ(""); setHits([]); }}>
                    <span className="font-medium">{h.name}</span>
                    {h.department ? <span className="muted"> · {h.department}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
