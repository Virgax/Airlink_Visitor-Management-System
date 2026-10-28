"use client";

import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { Icon } from "@/components/Icon";

export type PersonHit = { id: string; name: string; department: string | null };

export type PersonPickerLabels = {
  label: string;
  placeholder: string;
  help: string;
  searching: string;
  none: string;
  selected: string;
  change: string;
};

/**
 * Name search backed by a server action; the choice lands in a hidden input (`name`). Used by the gate QR
 * self sign-in (host / employee) and the manual sign-in from the admin panel. Labels come from the server page
 * so the component stays free of translation namespaces.
 */
export function PersonPicker({ name, search, labels, inputId = "personSearch" }: { name: string; search: (q: string) => Promise<PersonHit[]>; labels: PersonPickerLabels; inputId?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PersonHit | null>(null);

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
    <div data-testid={`${name}-picker`}>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      {selected ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2" data-testid={`${name}-selected`}>
          <Icon icon={UserCheck} />
          <div className="min-w-0 flex-1">
            <p className="muted text-xs">{labels.selected}</p>
            <p className="font-medium">{selected.name}{selected.department ? ` · ${selected.department}` : ""}</p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={() => setSelected(null)}>{labels.change}</button>
        </div>
      ) : (
        <>
          <label className="label" htmlFor={inputId}>{labels.label}</label>
          <input id={inputId} value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.placeholder} autoComplete="off" className="input" aria-describedby={`${inputId}-help`} />
          <p id={`${inputId}-help`} className="muted mt-1 text-xs">{labels.help}</p>
          {q.trim().length >= 2 ? (
            <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-border" data-testid={`${name}-results`}>
              {searching && hits.length === 0 ? <li className="muted px-3 py-2">{labels.searching}</li> : null}
              {!searching && hits.length === 0 ? <li className="muted px-3 py-2">{labels.none}</li> : null}
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
