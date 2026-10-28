"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserRoundCheck, X } from "lucide-react";
import { Icon } from "@/components/Icon";

export type FrequentHit = { id: string; name: string; company: string | null };

/**
 * Autocomplete of active frequent visitors for the host invite form. Picking one reloads the form with
 * `?frequent=<id>` so the server pre-fills name, company, phone and copies the hashed document.
 */
export function FrequentPicker({ siteId, selected, search }: { siteId: string; selected: FrequentHit | null; search: (siteId: string, q: string) => Promise<FrequentHit[]> }) {
  const t = useTranslations("people.frequent");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FrequentHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await search(siteId, q);
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
  }, [q, search, siteId]);

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2" data-testid="frequent-selected">
        <Icon icon={UserRoundCheck} />
        <p className="min-w-0 flex-1 text-sm">{t("pickerSelected", { name: selected.name })}</p>
        <button type="button" className="btn-secondary text-sm" onClick={() => router.push(`/app/passes/new?siteId=${encodeURIComponent(siteId)}`)}>
          <Icon icon={X} /> {t("pickerClear")}
        </button>
      </div>
    );
  }
  return (
    <div>
      <label className="label" htmlFor="frequentSearch">{t("pickerLabel")}</label>
      <input id="frequentSearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pickerPlaceholder")} autoComplete="off" className="input" aria-describedby="frequent-help" data-testid="frequent-search" />
      <p id="frequent-help" className="muted mt-1 text-xs">{t("pickerHelp")}</p>
      {q.trim().length >= 2 ? (
        <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-border" data-testid="frequent-results">
          {searching && hits.length === 0 ? <li className="muted px-3 py-2">{t("pickerSearching")}</li> : null}
          {!searching && hits.length === 0 ? <li className="muted px-3 py-2">{t("pickerNone")}</li> : null}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => router.push(`/app/passes/new?siteId=${encodeURIComponent(siteId)}&frequent=${encodeURIComponent(h.id)}`)}>
                <span className="font-medium">{h.name}</span>
                {h.company ? <span className="muted"> · {h.company}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
