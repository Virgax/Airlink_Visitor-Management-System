"use client";

import { useState } from "react";

export type IdScannerLabels = {
  hint: string;
  optional: string;
  reading: string;
  found: string; // ICU-free: "{name}" and "{doc}" replaced here
  unverified: string;
  notFound: string;
  error: string;
  docTypes: Record<"cedula" | "passport" | "id", string>;
  expires: string;
  /** Standalone input only: the photo is read, not stored. */
  privacy?: string;
};
type Slot = { slot: "idFront" | "idBack"; label: string; done: boolean; capture: "environment" };
type Identity = { docType: "cedula" | "passport" | "id"; docNumber: string; fullName: string; nationality: string | null; expiryDate: string | null; valid: boolean };

/**
 * The identity-document photo inputs of the visitor form. When a photo is taken, it is sent to the MRZ reader and
 * the result pre-fills the name and document fields (the visitor can still correct them); hidden fields carry what
 * the document said so the server keeps it with the pass. With `standalone` (the site does not require photos) the
 * input is optional and not submitted: it only reads.
 */
export function IdScanner({ token, slots, standalone, labels }: { token: string; slots: Slot[]; standalone?: boolean; labels: IdScannerLabels }) {
  const [state, setState] = useState<{ kind: "idle" | "reading" | "found" | "notFound" | "unverified" | "error"; identity?: Identity }>({ kind: "idle" });

  async function read(file: File | null) {
    if (!file) return;
    setState({ kind: "reading" });
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/v/${encodeURIComponent(token)}/mrz`, { method: "POST", body });
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const json = (await res.json()) as { found: boolean; identity?: Identity };
      if (!json.found || !json.identity) {
        setState({ kind: "notFound" });
        return;
      }
      // A read whose check digits failed is not trusted: a covered or blurry line reads as plausible but wrong data.
      if (!json.identity.valid) {
        setState({ kind: "unverified" });
        return;
      }
      fill("name", json.identity.fullName);
      fill("doc", json.identity.docNumber);
      setState({ kind: "found", identity: json.identity });
    } catch {
      setState({ kind: "error" });
    }
  }

  const id = state.identity;
  const status =
    state.kind === "reading" ? labels.reading
    : state.kind === "found" && id ? labels.found.replace("{name}", id.fullName).replace("{doc}", `${labels.docTypes[id.docType]} ${id.docNumber}${id.expiryDate ? ` · ${labels.expires.replace("{date}", id.expiryDate)}` : ""}`)
    : state.kind === "notFound" ? labels.notFound
    : state.kind === "unverified" ? labels.unverified
    : state.kind === "error" ? labels.error
    : null;

  return (
    <div className="space-y-3" data-testid="id-scanner" data-state={state.kind}>
      {standalone ? (
        <div>
          <label className="label" htmlFor="id-scan">{labels.optional}</label>
          <input id="id-scan" type="file" accept="image/*" capture="environment" className="input" onChange={(e) => void read(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        slots.map((p) => (
          <div key={p.slot} data-testid={`photo-${p.slot}`} data-done={p.done ? "1" : "0"}>
            <label className="label" htmlFor={`photo-${p.slot}`}>{p.label}</label>
            <input id={`photo-${p.slot}`} name={p.slot} type="file" accept="image/*" capture={p.capture} className="input" required={!p.done} onChange={(e) => void read(e.target.files?.[0] ?? null)} />
          </div>
        ))
      )}
      <p className="muted text-xs">{labels.hint}{standalone && labels.privacy ? ` ${labels.privacy}` : ""}</p>
      {status ? (
        <p className={`text-sm ${state.kind === "found" ? "text-success" : state.kind === "reading" ? "muted" : "text-warning"}`} role="status" data-testid="id-scan-status">{status}</p>
      ) : null}
      {id ? (
        <>
          <input type="hidden" name="idType" value={id.docType} />
          <input type="hidden" name="idNationality" value={id.nationality ?? ""} />
          <input type="hidden" name="idExpiry" value={id.expiryDate ?? ""} />
          <input type="hidden" name="idVerified" value={id.valid ? "1" : "0"} />
        </>
      ) : null}
    </div>
  );
}

/** Pre-fills an input of the surrounding form when the visitor has not typed in it yet. */
function fill(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement) || !value) return;
  if (el.value.trim() && el.dataset.filledBy !== "scan") return;
  el.value = value;
  el.dataset.filledBy = "scan";
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
