"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Icon } from "@/components/Icon";
import { DEVICE_FIELDS, MAX_DEVICES, type Device, type DeviceKind } from "@/lib/forms/schema";

export type DeviceLabels = {
  kinds: Record<DeviceKind, string>;
  kind: string;
  id: string;
  idHelp: string;
  model: string;
  color: string;
  add: string;
  remove: string;
  none: string;
  registered: string;
};

type Row = { key: number; kind: DeviceKind; id: string; model: string; color: string };

/**
 * Personal devices block of a sign-in form: one row per device (kind, IMEI/serial, model, colour) posted as repeated
 * fields, plus the "I bring no device" declaration. Rows already registered (by the host, or earlier by the visitor)
 * are shown as defaults so the visitor completes rather than retypes.
 */
export function DevicesField({ kinds, initial = [], none = false, required, labels, idPrefix = "", preview = false, readOnly = false }: { kinds: readonly DeviceKind[]; initial?: Device[]; none?: boolean; required: boolean; labels: DeviceLabels; idPrefix?: string; preview?: boolean; readOnly?: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map((d, i) => ({ key: i, ...d })) : [{ key: 0, kind: kinds[0] ?? "phone", id: "", model: "", color: "" }]));
  const [noDevices, setNoDevices] = useState(none);
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((list) => (list.length >= MAX_DEVICES ? list : [...list, { key: Date.now(), kind: kinds[0] ?? "phone", id: "", model: "", color: "" }]));
  const remove = (key: number) => setRows((list) => list.filter((r) => r.key !== key));

  if (readOnly) {
    return (
      <ul className="space-y-1 text-sm" data-testid="devices-list">
        {initial.length === 0 ? <li className="muted">{labels.none}</li> : null}
        {initial.map((d) => (
          <li key={d.id} data-device-id={d.id}><span className="font-medium">{labels.kinds[d.kind]}</span> · {d.model || "—"} · {d.color || "—"} · <span className="font-mono">{d.id}</span></li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2" data-testid="devices-field">
      {!noDevices ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1.4fr_1fr_1fr_auto]" data-testid="device-row">
              <div>
                <label className="label" htmlFor={`${idPrefix}dev-kind-${r.key}`}>{labels.kind}</label>
                <select id={`${idPrefix}dev-kind-${r.key}`} name={DEVICE_FIELDS.kind} className="input text-sm" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as DeviceKind })} disabled={preview}>
                  {kinds.map((k) => <option key={k} value={k}>{labels.kinds[k]}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`${idPrefix}dev-id-${r.key}`}>{labels.id}</label>
                <input id={`${idPrefix}dev-id-${r.key}`} name={DEVICE_FIELDS.id} className="input font-mono text-sm" value={r.id} onChange={(e) => update(r.key, { id: e.target.value })} maxLength={30} autoComplete="off" inputMode="text" required={required && !preview && i === 0} placeholder={labels.idHelp} disabled={preview} />
              </div>
              <div>
                <label className="label" htmlFor={`${idPrefix}dev-model-${r.key}`}>{labels.model}</label>
                <input id={`${idPrefix}dev-model-${r.key}`} name={DEVICE_FIELDS.model} className="input text-sm" value={r.model} onChange={(e) => update(r.key, { model: e.target.value })} maxLength={60} autoComplete="off" disabled={preview} />
              </div>
              <div>
                <label className="label" htmlFor={`${idPrefix}dev-color-${r.key}`}>{labels.color}</label>
                <input id={`${idPrefix}dev-color-${r.key}`} name={DEVICE_FIELDS.color} className="input text-sm" value={r.color} onChange={(e) => update(r.key, { color: e.target.value })} maxLength={30} autoComplete="off" disabled={preview} />
              </div>
              <div className="flex items-end">
                <button type="button" className="btn-secondary px-2 py-2 text-danger" onClick={() => remove(r.key)} title={labels.remove} aria-label={labels.remove} disabled={preview || rows.length === 1}><Icon icon={Trash2} size={16} /></button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-secondary text-sm" onClick={add} disabled={preview || rows.length >= MAX_DEVICES} data-testid="add-device"><Icon icon={Plus} size={14} /> {labels.add}</button>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={DEVICE_FIELDS.none} checked={noDevices} onChange={(e) => setNoDevices(e.target.checked)} disabled={preview} data-testid="devices-none" /> {labels.none}
      </label>
    </div>
  );
}
