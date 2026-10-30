"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2, Upload } from "lucide-react";
import { Icon } from "@/components/Icon";
import { FormFields, type FormLabels } from "@/components/forms/FormFields";
import { BUILTIN_TYPES, CUSTOM_TYPES, formElementsSchema, isBuiltin, newElementId, SURFACES, withDefaultBuiltins, type BuiltinElement, type ElementType, type FormElement, type FormSurface, BUILTIN_SURFACES } from "@/lib/forms/schema";
import type { UploadResult } from "@/app/admin/forms/actions";

type Template = { id: string; name: string; elements: FormElement[] };

type Props = {
  template: Template;
  readOnly: boolean;
  save: (formData: FormData) => Promise<void>;
  upload: (formData: FormData) => Promise<UploadResult>;
};

function makeElement(type: ElementType, existing: FormElement[]): FormElement {
  const id = newElementId(type, existing.map((e) => e.id));
  const base = { id, showOn: [...SURFACES] as FormSurface[], onBadge: false };
  switch (type) {
    case "text": return { ...base, type };
    case "question": return { ...base, type, questionType: "text", options: [], required: false, showOn: ["host", "visitor", "kiosk"] };
    case "media": return { ...base, type };
    case "signature": return { ...base, type, required: true, showOn: ["visitor"] };
    default: return { ...base, type, mode: "optional", showOn: [...BUILTIN_SURFACES[type]] };
  }
}

/**
 * Visual editor for a form template: palette → ordered list (move up/down, remove) → properties panel of the selected
 * element → live preview per surface. The element list travels as JSON in the `elements` field of a plain form so the
 * save is a normal server action (CSP-safe); the shared Zod schema validates on both sides.
 */
export function FormEditor({ template, readOnly, save, upload }: Props) {
  const t = useTranslations("forms.editor");
  const tt = useTranslations("forms.types");
  const tr = useTranslations("forms.render");
  const [elements, setElements] = useState<FormElement[]>(template.elements);
  const [selectedId, setSelectedId] = useState<string | null>(template.elements[0]?.id ?? null);
  const [surface, setSurface] = useState<FormSurface>("visitor");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const validation = useMemo(() => formElementsSchema.safeParse(elements), [elements]);
  const KNOWN_ISSUES = ["duplicate_id", "duplicate_builtin", "select_needs_options"];
  const issues = validation.success
    ? []
    : validation.error.issues.map((i) => {
        const path = i.path.map((p) => (typeof p === "number" ? elements[p]?.id ?? String(p) : String(p))).join(".");
        return `${path}: ${t(`issues.${KNOWN_ISSUES.includes(i.message) ? i.message : "invalid"}` as "issues.invalid")}`;
      });
  const labels: FormLabels = {
    required: tr("required"),
    choose: tr("choose"),
    openDocument: tr("openDocument"),
    mediaMissing: tr("mediaMissing"),
    listPlaceholder: tr("listPlaceholder"),
    signature: { draw: tr("signature.draw"), clear: tr("signature.clear"), typedName: tr("signature.typedName"), typedNameHelp: tr("signature.typedNameHelp"), drawn: tr("signature.drawn") },
  };

  const update = (id: string, patch: Partial<FormElement>) => setElements((list) => list.map((e) => (e.id === id ? ({ ...e, ...patch } as FormElement) : e)));
  const add = (type: ElementType) => {
    const el = makeElement(type, elements);
    setElements((list) => [...list, el]);
    setSelectedId(el.id);
  };
  const move = (id: string, dir: -1 | 1) =>
    setElements((list) => {
      const i = list.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  const remove = (id: string) => {
    setElements((list) => list.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const onUpload = async (file: File | undefined) => {
    if (!file || !selected || selected.type !== "media") return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.set("id", template.id);
      fd.set("file", file);
      const res = await upload(fd);
      if (res.ok) update(selected.id, { mediaKey: res.key, mediaType: res.mediaType });
      else setUploadError(t(`upload.${res.error}`));
    } catch {
      setUploadError(t("upload.invalid"));
    } finally {
      setUploading(false);
    }
  };

  const typeLabel = (e: FormElement) => tt(e.type);
  const summary = (e: FormElement) => e.label || (isBuiltin(e) ? tt(e.type) : e.id);

  const previewBuiltin = (e: BuiltinElement) => (
    <div>
      <label className="label">{e.label || tt(e.type)}{e.mode === "required" ? <span className="text-danger"> *</span> : null}</label>
      <input className="input" disabled placeholder={tt(e.type)} />
      {e.help ? <p className="muted mt-1">{e.help}</p> : null}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]" data-testid="form-editor">
      <form action={save} className="card space-y-4">
        <input type="hidden" name="id" value={template.id} />
        <input type="hidden" name="elements" value={JSON.stringify(elements)} />
        <div>
          <label className="label" htmlFor="tpl-name">{t("name")}</label>
          <input id="tpl-name" name="name" className="input" defaultValue={template.name} minLength={2} maxLength={80} required disabled={readOnly} />
        </div>

        <div>
          <h2 className="mb-2 font-medium">{t("palette")}</h2>
          <div className="flex flex-wrap gap-2">
            {[...BUILTIN_TYPES, ...CUSTOM_TYPES].map((type) => {
              const present = (BUILTIN_TYPES as readonly string[]).includes(type) && elements.some((e) => e.type === type);
              return (
                <button key={type} type="button" className="btn-secondary text-sm" disabled={readOnly || present} onClick={() => add(type)} data-testid={`add-${type}`}>
                  <Icon icon={Plus} size={14} /> {tt(type)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-medium">{t("elements", { count: elements.length })}</h2>
          {elements.length === 0 ? <p className="muted">{t("emptyList")}</p> : null}
          <ol className="space-y-1" data-testid="element-list">
            {elements.map((e, i) => (
              <li key={e.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${e.id === selectedId ? "border-primary bg-surface-2" : "border-border"}`} data-element-id={e.id}>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setSelectedId(e.id)} aria-current={e.id === selectedId ? "true" : undefined}>
                  <span className="muted mr-2 text-xs uppercase">{typeLabel(e)}</span>
                  <span className="font-medium">{summary(e)}</span>
                  <span className="muted ml-2 text-xs">{e.showOn.map((s) => t(`surfaces.${s}`)).join(" · ")}</span>
                </button>
                <button type="button" className="btn-secondary px-2 py-1" disabled={readOnly || i === 0} onClick={() => move(e.id, -1)} title={t("moveUp")} aria-label={t("moveUp")}><Icon icon={ArrowUp} size={14} /></button>
                <button type="button" className="btn-secondary px-2 py-1" disabled={readOnly || i === elements.length - 1} onClick={() => move(e.id, 1)} title={t("moveDown")} aria-label={t("moveDown")}><Icon icon={ArrowDown} size={14} /></button>
                <button type="button" className="btn-secondary px-2 py-1 text-danger" disabled={readOnly} onClick={() => remove(e.id)} title={t("remove")} aria-label={t("remove")}><Icon icon={Trash2} size={14} /></button>
              </li>
            ))}
          </ol>
        </div>

        {selected ? (
          <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={readOnly} data-testid="properties">
            <legend className="px-1 text-sm font-medium">{t("properties")} · {typeLabel(selected)}</legend>
            <div>
              <label className="label" htmlFor="prop-label">{t("label")}</label>
              <input id="prop-label" className="input" maxLength={120} value={selected.label ?? ""} onChange={(ev) => update(selected.id, { label: ev.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="prop-help">{selected.type === "text" ? t("textBody") : t("help")}</label>
              <textarea id="prop-help" className="input" rows={selected.type === "text" ? 5 : 2} maxLength={2000} value={selected.help ?? ""} onChange={(ev) => update(selected.id, { help: ev.target.value })} />
              <p className="muted mt-1">{t("helpHint")}</p>
            </div>
            <details className="rounded-lg border border-border p-2" data-testid="english-texts" open={Boolean(selected.labelEn || selected.helpEn)}>
              <summary className="cursor-pointer text-sm font-medium">{t("english")}</summary>
              <p className="muted mt-1 text-xs">{t("englishHint")}</p>
              <div className="mt-2 space-y-2">
                <div>
                  <label className="label" htmlFor="prop-label-en">{t("labelEn")}</label>
                  <input id="prop-label-en" className="input" maxLength={120} value={selected.labelEn ?? ""} onChange={(ev) => update(selected.id, { labelEn: ev.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="prop-help-en">{selected.type === "text" ? t("textBodyEn") : t("helpEn")}</label>
                  <textarea id="prop-help-en" className="input" rows={selected.type === "text" ? 4 : 2} maxLength={2000} value={selected.helpEn ?? ""} onChange={(ev) => update(selected.id, { helpEn: ev.target.value })} />
                </div>
              </div>
            </details>
            {isBuiltin(selected) ? (
              <div>
                <label className="label" htmlFor="prop-mode">{t("mode")}</label>
                <select id="prop-mode" className="input" value={selected.mode} onChange={(ev) => update(selected.id, { mode: ev.target.value as BuiltinElement["mode"] })}>
                  <option value="off">{t("modes.off")}</option>
                  <option value="optional">{t("modes.optional")}</option>
                  <option value="required">{t("modes.required")}</option>
                </select>
              </div>
            ) : null}
            {selected.type === "question" ? (
              <>
                <div>
                  <label className="label" htmlFor="prop-qtype">{t("questionType")}</label>
                  <select id="prop-qtype" className="input" value={selected.questionType} onChange={(ev) => update(selected.id, { questionType: ev.target.value as "text" })}>
                    <option value="text">{t("questionTypes.text")}</option>
                    <option value="number">{t("questionTypes.number")}</option>
                    <option value="select">{t("questionTypes.select")}</option>
                    <option value="checkbox">{t("questionTypes.checkbox")}</option>
                    <option value="list">{t("questionTypes.list")}</option>
                  </select>
                </div>
                {selected.questionType === "select" ? (
                  <div>
                    <label className="label" htmlFor="prop-options">{t("options")}</label>
                    <textarea id="prop-options" className="input" rows={4} value={selected.options.join("\n")} onChange={(ev) => update(selected.id, { options: ev.target.value.split("\n").map((o) => o.trim()).filter(Boolean).slice(0, 30) })} />
                    <p className="muted mt-1">{t("optionsHint")}</p>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.required} onChange={(ev) => update(selected.id, { required: ev.target.checked })} /> {t("required")}</label>
              </>
            ) : null}
            {selected.type === "signature" ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.required} onChange={(ev) => update(selected.id, { required: ev.target.checked })} /> {t("required")}</label>
            ) : null}
            {selected.type === "media" ? (
              <div className="space-y-2">
                <p className="muted">{selected.mediaKey ? t("mediaCurrent", { key: selected.mediaKey }) : t("mediaNone")}</p>
                <label className="btn-secondary inline-flex cursor-pointer text-sm">
                  <Icon icon={Upload} /> {uploading ? t("uploading") : t("uploadMedia")}
                  <input type="file" accept="image/png,image/jpeg,application/pdf" className="sr-only" disabled={uploading} onChange={(ev) => void onUpload(ev.target.files?.[0])} />
                </label>
                {uploadError ? <p className="alert-error">{uploadError}</p> : null}
              </div>
            ) : null}
            <fieldset>
              <legend className="label">{t("showOn")}</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {SURFACES.map((s) => (
                  <label key={s} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.showOn.includes(s)}
                      onChange={(ev) => update(selected.id, { showOn: ev.target.checked ? [...selected.showOn, s] : selected.showOn.filter((x) => x !== s) })}
                    />
                    {t(`surfaces.${s}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            {selected.type === "question" || isBuiltin(selected) ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.onBadge} onChange={(ev) => update(selected.id, { onBadge: ev.target.checked })} /> {t("onBadge")}</label>
            ) : null}
          </fieldset>
        ) : null}

        {issues.length ? (
          <ul className="alert-error space-y-1" role="alert">
            {issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        ) : null}
        {!readOnly ? (
          <button type="submit" className="btn-primary" disabled={!validation.success}><Icon icon={Save} /> {t("save")}</button>
        ) : null}
      </form>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-medium"><Icon icon={Eye} /> {t("preview")}</h2>
          <div className="flex gap-1" role="tablist" aria-label={t("preview")}>
            {SURFACES.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={surface === s} className={surface === s ? "btn-primary text-sm" : "btn-secondary text-sm"} onClick={() => setSurface(s)}>
                {t(`surfaces.${s}`)}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">{t("previewHelp")}</p>
        <div className="space-y-4 rounded-lg border border-dashed border-border p-3" data-testid="form-preview">
          <FormFields elements={withDefaultBuiltins(elements, "visit")} surface={surface} labels={labels} preview idPrefix="pv-" renderBuiltin={previewBuiltin} />
        </div>
      </section>
    </div>
  );
}
