"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Icon } from "@/components/Icon";
import { DEVICE_FIELDS, MAX_DEVICES, type Device, type DeviceKind } from "@/lib/forms/schema";
import { describeDevice } from "@/lib/forms/devices";

export type DeviceLabels = {
  kinds: Record<DeviceKind, string>;
  kind: string;
  imei: string;
  imeiHelp: string;
  serial: string;
  model: string;
  color: string;
  capacity: string;
  /** Placeholder of the capacity box per kind ("256 GB", "512 GB SSD · 16 GB RAM"…). */
  capacityHints: Record<DeviceKind, string>;
  add: string;
  remove: string;
  none: string;
  registered: string;
};

type Row = { key: number; kind: DeviceKind; imei: string; serial: string; model: string; color: string; capacity: string };

const blank = (kind: DeviceKind, key: number): Row => ({ key, kind, imei: "", serial: "", model: "", color: "", capacity: "" });

/**
 * Personal devices block of a sign-in form: one row per device (kind, IMEI for phones, serial, model, colour,
 * capacity) posted as repeated fields, plus the "I bring no device" declaration. Rows already registered (by the
 * host, or earlier by the visitor) are shown as defaults so the visitor completes rather than retypes.
 */
export function DevicesField({ kinds, initial = [], none = false, required, labels, idPrefix = "", preview = false, readOnly = false }: { kinds: readonly DeviceKind[]; initial?: Device[]; none?: boolean; required: boolean; labels: DeviceLabels; idPrefix?: string; preview?: boolean; readOnly?: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map((d, i) => ({ key: i, kind: d.kind, imei: d.imei ?? "", serial: d.serial ?? "", model: d.model, color: d.color, capacity: d.capacity ?? "" })) : [blank(kinds[0] ?? "phone", 0)]));
  const [noDevices, setNoDevices] = useState(none);
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => setRows((list) => (list.length >= MAX_DEVICES ? list : [...list, blank(kinds[0] ?? "phone", Date.now())]));
  const remove = (key: number) => setRows((list) => list.filter((r) => r.key !== key));

  if (readOnly) {
    return (
      <ul className="space-y-1 text-sm" data-testid="devices-list">
        {initial.length === 0 ? <li className="muted">{labels.none}</li> : null}
        {initial.map((d) => <li key={d.id} data-device-id={d.id}>{describeDevice(d, labels)}</li>)}
      </ul>
    );
  }

  const field = (r: Row, name: keyof typeof DEVICE_FIELDS, label: string, value: string, patch: (v: string) => Partial<Row>, extra: { placeholder?: string; mono?: boolean; required?: boolean; maxLength?: number } = {}) => {
    const id = `${idPrefix}dev-${name}-${r.key}`;
    return (
      <div>
        <label className="label" htmlFor={id}>{label}</label>
        <input id={id} name={DEVICE_FIELDS[name]} className={`input text-sm ${extra.mono ? "font-mono" : ""}`} value={value} onChange={(e) => update(r.key, patch(e.target.value))} maxLength={extra.maxLength ?? 40} autoComplete="off" placeholder={extra.placeholder} required={Boolean(extra.required) && !preview} disabled={preview} />
      </div>
    );
  };

  return (
    <div className="space-y-2" data-testid="devices-field">
      {!noDevices ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="space-y-2 rounded-lg border border-border p-2" data-testid="device-row" data-kind={r.kind}>
              <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1.4fr_auto]">
                <div>
                  <label className="label" htmlFor={`${idPrefix}dev-kind-${r.key}`}>{labels.kind}</label>
                  <select id={`${idPrefix}dev-kind-${r.key}`} name={DEVICE_FIELDS.kind} className="input text-sm" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as DeviceKind })} disabled={preview}>
                    {kinds.map((k) => <option key={k} value={k}>{labels.kinds[k]}</option>)}
                  </select>
                </div>
                {r.kind === "phone" ? field(r, "imei", labels.imei, r.imei, (v) => ({ imei: v }), { placeholder: labels.imeiHelp, mono: true, required: required && i === 0 && !r.serial, maxLength: 20 }) : <input type="hidden" name={DEVICE_FIELDS.imei} value="" />}
                {field(r, "serial", labels.serial, r.serial, (v) => ({ serial: v }), { mono: true, required: required && i === 0 && !(r.kind === "phone" && r.imei) })}
                <div className="flex items-end">
                  <button type="button" className="btn-secondary px-2 py-2 text-danger" onClick={() => remove(r.key)} title={labels.remove} aria-label={labels.remove} disabled={preview || rows.length === 1}><Icon icon={Trash2} size={16} /></button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {field(r, "model", labels.model, r.model, (v) => ({ model: v }), { maxLength: 60 })}
                {field(r, "color", labels.color, r.color, (v) => ({ color: v }), { maxLength: 30 })}
                {field(r, "capacity", labels.capacity, r.capacity, (v) => ({ capacity: v }), { placeholder: labels.capacityHints[r.kind] })}
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
