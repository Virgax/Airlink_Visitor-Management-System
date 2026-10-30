import type { ReactNode } from "react";
import { elementsFor, elementText, fieldName, isBuiltin, isRequired, MAX_LIST_ANSWER, MAX_TEXT_ANSWER, parseHelp, splitBold, type Answers, type BuiltinElement, type ElementType, type FormElement, type FormSurface, type MediaElement, type QuestionElement, type SignatureElement } from "@/lib/forms/schema";
import { SignaturePad } from "./SignaturePad";

/** UI words the renderer needs (from `forms.render.*`), passed in so this component works on the server and in the client preview. */
export type FormLabels = {
  required: string;
  choose: string;
  openDocument: string;
  mediaMissing: string;
  /** Placeholder of a `list` question ("Una por línea"). */
  listPlaceholder: string;
  signature: { draw: string; clear: string; typedName: string; typedNameHelp: string; drawn: string };
};

export type FormFieldsProps = {
  elements: FormElement[];
  surface: FormSurface;
  labels: FormLabels;
  /** Stored answers used as default values. */
  answers?: Answers;
  /** URL of a media key (adds the pass token on the public page). */
  mediaHref?: (key: string) => string;
  /** How the page renders each built-in field; built-ins without a renderer are skipped. */
  renderBuiltin?: (e: BuiltinElement) => ReactNode;
  /** Element types left out (e.g. the signature, rendered inside the NDA form instead). */
  exclude?: ElementType[];
  /** Prefix for input ids when the same form is rendered more than once on a page. */
  idPrefix?: string;
  /** Preview mode: inputs are not required and nothing is submitted. */
  preview?: boolean;
  /** Reader's UI language: English texts of the elements are used when present. */
  locale?: string;
};

/**
 * Renders the elements of a sign-in form for one surface, in the order HR set. Custom elements are rendered here;
 * built-in fields come from the page through `renderBuiltin` so each surface keeps its own inputs and names.
 */
export function FormFields({ elements, surface, labels, answers = {}, mediaHref, renderBuiltin, exclude = [], idPrefix = "", preview = false, locale }: FormFieldsProps) {
  const visible = elementsFor(elements, surface).filter((e) => !exclude.includes(e.type));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((e) => {
        if (isBuiltin(e)) return renderBuiltin ? <div key={e.id} data-builtin={e.type} data-element={e.id}>{renderBuiltin(e)}</div> : null;
        switch (e.type) {
          case "text":
            return <TextBlock key={e.id} element={e} locale={locale} />;
          case "question":
            return <Question key={e.id} element={e} answers={answers} labels={labels} idPrefix={idPrefix} preview={preview} locale={locale} />;
          case "media":
            return <Media key={e.id} element={e} labels={labels} href={mediaHref} locale={locale} />;
          case "signature":
            return <Signature key={e.id} element={e} labels={labels} idPrefix={idPrefix} preview={preview} locale={locale} />;
          default:
            return null;
        }
      })}
    </>
  );
}

/** Markdown-ish instructions: paragraphs, `- ` lists and **bold**. */
export function HelpText({ text, className = "muted" }: { text: string | undefined | null; className?: string }) {
  const blocks = parseHelp(text);
  if (blocks.length === 0) return null;
  return (
    <div className={`${className} space-y-1`}>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{inline(b.text)}</p>
        ) : (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}

function inline(text: string): ReactNode {
  return splitBold(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>));
}

function RequiredMark({ element, labels }: { element: FormElement; labels: FormLabels }) {
  return isRequired(element) ? <span className="text-danger" aria-label={labels.required}> *</span> : null;
}

function TextBlock({ element, locale }: { element: FormElement; locale?: string }) {
  const text = elementText(element, locale);
  return (
    <div className="rounded-lg bg-surface-2 p-3" data-element={element.id} data-element-type="text">
      {text.label ? <h3 className="mb-1 font-medium">{text.label}</h3> : null}
      <HelpText text={text.help} className="text-sm text-text" />
    </div>
  );
}

function Question({ element: e, answers, labels, idPrefix, preview, locale }: { element: QuestionElement; answers: Answers; labels: FormLabels; idPrefix: string; preview: boolean; locale?: string }) {
  const name = fieldName(e);
  const inputId = `${idPrefix}${name}`;
  const text = elementText(e, locale);
  const helpId = text.help ? `${inputId}-help` : undefined;
  const stored = answers[e.id]?.value;
  const required = e.required && !preview;
  const label = text.label ?? e.id;
  if (e.questionType === "checkbox") {
    return (
      <div data-element={e.id} data-element-type="question">
        <label className="flex items-start gap-2 text-sm">
          <input id={inputId} type="checkbox" name={name} className="mt-1" required={required} defaultChecked={stored === true} aria-describedby={helpId} />
          <span>{label}<RequiredMark element={e} labels={labels} /></span>
        </label>
        {text.help ? <HelpText text={text.help} /> : null}
      </div>
    );
  }
  return (
    <div data-element={e.id} data-element-type="question">
      <label className="label" htmlFor={inputId}>{label}<RequiredMark element={e} labels={labels} /></label>
      {e.questionType === "list" ? (
        <textarea id={inputId} name={name} rows={3} maxLength={MAX_LIST_ANSWER} className="input" required={required} defaultValue={typeof stored === "string" ? stored : ""} aria-describedby={helpId} placeholder={labels.listPlaceholder} />
      ) : e.questionType === "select" ? (
        <select id={inputId} name={name} className="input" required={required} defaultValue={typeof stored === "string" ? stored : ""} aria-describedby={helpId}>
          <option value="">{labels.choose}</option>
          {e.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : e.questionType === "number" ? (
        <input id={inputId} name={name} type="number" step="any" inputMode="decimal" className="input" required={required} defaultValue={typeof stored === "number" ? stored : ""} aria-describedby={helpId} />
      ) : (
        <input id={inputId} name={name} type="text" maxLength={MAX_TEXT_ANSWER} className="input" required={required} defaultValue={typeof stored === "string" ? stored : ""} aria-describedby={helpId} autoComplete="off" />
      )}
      {text.help ? <div id={helpId} className="mt-1"><HelpText text={text.help} /></div> : null}
    </div>
  );
}

function Media({ element: e, labels, href, locale }: { element: MediaElement; labels: FormLabels; href?: (key: string) => string; locale?: string }) {
  const url = e.mediaKey && href ? href(e.mediaKey) : e.mediaKey ? `/api/media/${e.mediaKey}` : null;
  const isPdf = e.mediaType === "pdf" || (e.mediaKey?.endsWith(".pdf") ?? false);
  const text = elementText(e, locale);
  return (
    <div className="space-y-2" data-element={e.id} data-element-type="media">
      {text.label ? <h3 className="font-medium">{text.label}</h3> : null}
      {text.help ? <HelpText text={text.help} /> : null}
      {!url ? (
        <p className="muted italic">{labels.mediaMissing}</p>
      ) : isPdf ? (
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary inline-flex">{labels.openDocument}</a>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private media served by /api/media
        <img src={url} alt={text.label ?? ""} className="max-h-80 w-auto rounded-lg border border-border" />
      )}
    </div>
  );
}

function Signature({ element: e, labels, idPrefix, preview, locale }: { element: SignatureElement; labels: FormLabels; idPrefix: string; preview: boolean; locale?: string }) {
  const text = elementText(e, locale);
  return (
    <div className="space-y-2" data-element={e.id} data-element-type="signature">
      {text.label ? <h3 className="font-medium">{text.label}<RequiredMark element={e} labels={labels} /></h3> : null}
      {text.help ? <HelpText text={text.help} /> : null}
      <SignaturePad idPrefix={idPrefix} labels={labels.signature} preview={preview} />
    </div>
  );
}
