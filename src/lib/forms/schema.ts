/**
 * Sign-in form model built by HR in /admin/forms and stored as JSON (`FormTemplate.elements`, `VisitPolicy.form`).
 * Pure: no database, no React. Everything that reads or validates a form (policy evaluation, the renderer, the
 * server actions that store answers) goes through this module so every surface agrees on what is required.
 *
 * An element is either a built-in field (document, phone, areas…) with a `mode` that switches it off, optional or
 * required, or a custom block: instructions (`text`), a `question` (text/number/select/checkbox), a `media` file
 * from the bucket, or a drawn `signature` for the NDA. Every element says on which surfaces it shows
 * (`host` invite form, `visitor` link pre-registration, `kiosk` unannounced form) and whether its answer is printed
 * on the badge.
 */
import type { VisitKind } from "@prisma/client";
import { z } from "zod";

export const BUILTIN_TYPES = ["photo", "document", "name", "phone", "email", "company", "plate", "areas", "host", "escort"] as const;
export const CUSTOM_TYPES = ["text", "question", "media", "signature"] as const;
export const ELEMENT_TYPES = [...BUILTIN_TYPES, ...CUSTOM_TYPES] as const;
export const SURFACES = ["host", "visitor", "kiosk"] as const;
export const MODES = ["off", "optional", "required"] as const;
export const QUESTION_TYPES = ["text", "number", "select", "checkbox"] as const;
export const MAX_ELEMENTS = 60;
export const MAX_OPTIONS = 30;

export type BuiltinType = (typeof BUILTIN_TYPES)[number];
export type CustomType = (typeof CUSTOM_TYPES)[number];
export type ElementType = (typeof ELEMENT_TYPES)[number];
export type FormSurface = (typeof SURFACES)[number];
export type FieldMode = (typeof MODES)[number];
export type QuestionType = (typeof QUESTION_TYPES)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const label = z.string().trim().max(120).optional();
const help = z.string().trim().max(2000).optional();
const showOn = z.array(z.enum(SURFACES)).max(3).default([...SURFACES]);
const onBadge = z.boolean().default(false);

const base = { id, label, help, showOn, onBadge };

export const builtinElementSchema = z.object({ ...base, type: z.enum(BUILTIN_TYPES), mode: z.enum(MODES).default("optional") });
export const textElementSchema = z.object({ ...base, type: z.literal("text") });
export const questionElementSchema = z
  .object({
    ...base,
    type: z.literal("question"),
    questionType: z.enum(QUESTION_TYPES).default("text"),
    options: z.array(z.string().trim().min(1).max(120)).max(MAX_OPTIONS).default([]),
    required: z.boolean().default(false),
  })
  .refine((e) => e.questionType !== "select" || e.options.length > 0, { message: "select_needs_options", path: ["options"] });
export const mediaElementSchema = z.object({ ...base, type: z.literal("media"), mediaKey: z.string().max(200).optional(), mediaType: z.enum(["image", "pdf"]).optional() });
export const signatureElementSchema = z.object({ ...base, type: z.literal("signature"), required: z.boolean().default(true) });

export const formElementSchema = z.discriminatedUnion("type", [builtinElementSchema, textElementSchema, questionElementSchema, mediaElementSchema, signatureElementSchema]);

/** The element list as stored. Ids are unique; at most one element per built-in type. */
export const formElementsSchema = z
  .array(formElementSchema)
  .max(MAX_ELEMENTS)
  .superRefine((elements, ctx) => {
    const ids = new Set<string>();
    const builtins = new Set<string>();
    elements.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", message: "duplicate_id", path: [i, "id"] });
      ids.add(e.id);
      if (isBuiltin(e)) {
        if (builtins.has(e.type)) ctx.addIssue({ code: "custom", message: "duplicate_builtin", path: [i, "type"] });
        builtins.add(e.type);
      }
    });
  });

export type FormElement = z.infer<typeof formElementSchema>;
export type BuiltinElement = z.infer<typeof builtinElementSchema>;
export type QuestionElement = z.infer<typeof questionElementSchema>;
export type MediaElement = z.infer<typeof mediaElementSchema>;
export type SignatureElement = z.infer<typeof signatureElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;

export function isBuiltin(e: FormElement): e is BuiltinElement {
  return (BUILTIN_TYPES as readonly string[]).includes(e.type);
}

/** Parses stored JSON (an array, or `{ elements: [...] }`). Returns null for anything invalid instead of throwing. */
export function parseFormElements(json: unknown): FormElement[] | null {
  const raw = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { elements?: unknown }).elements) ? (json as { elements: unknown }).elements : null;
  if (!raw) return null;
  const parsed = formElementsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The subset of VisitPolicy the form model needs. */
export type FormPolicyFlags = { requiresDoc: boolean; escortRequired: boolean; requiresNda: boolean };

const DEFAULT_FLAGS: Record<VisitKind, FormPolicyFlags> = {
  visit: { requiresDoc: true, escortRequired: false, requiresNda: false },
  candidate: { requiresDoc: true, escortRequired: true, requiresNda: false },
  contractor: { requiresDoc: true, escortRequired: true, requiresNda: true },
  vendor: { requiresDoc: true, escortRequired: false, requiresNda: false },
  auditor: { requiresDoc: true, escortRequired: true, requiresNda: true },
  carrier: { requiresDoc: true, escortRequired: false, requiresNda: false },
  delivery: { requiresDoc: false, escortRequired: false, requiresNda: false },
  recurring: { requiresDoc: true, escortRequired: false, requiresNda: true },
};

function builtin(type: BuiltinType, mode: FieldMode, showOn: FormSurface[]): BuiltinElement {
  return { id: type, type, mode, showOn, onBadge: false };
}

/**
 * The form a kind has when nothing was configured: exactly today's behaviour. The document is required when the
 * policy says so, carriers need a plate, everything else is optional. Escort stays optional even when the policy
 * requires one (the requirement is a warning for security, not a form field), so defaults change nothing.
 */
export function defaultFormFor(kind: VisitKind, flags?: Partial<FormPolicyFlags> | null): FormElement[] {
  const f = { ...DEFAULT_FLAGS[kind], ...(flags ?? {}) };
  return [
    builtin("name", "required", ["host", "kiosk"]),
    builtin("company", "optional", ["host", "visitor", "kiosk"]),
    builtin("phone", "optional", ["host", "visitor"]),
    builtin("email", "optional", ["host"]),
    // The kiosk never forced a document on walk-ins (the guard decides), so the default lists it for host and visitor.
    builtin("document", f.requiresDoc ? "required" : "optional", ["host", "visitor"]),
    builtin("plate", kind === "carrier" ? "required" : "optional", ["host", "visitor", "kiosk"]),
    builtin("areas", "optional", ["host"]),
    builtin("host", "required", ["kiosk"]),
    builtin("escort", "optional", ["host"]),
    builtin("photo", "off", ["kiosk"]),
  ];
}

export type ResolvedForm = {
  elements: FormElement[];
  source: "template" | "inline" | "default";
  templateId: string | null;
  templateName: string | null;
};

export type FormPolicyLike = { kind: VisitKind; form?: unknown; formTemplateId?: string | null; requiresDoc?: boolean; escortRequired?: boolean; requiresNda?: boolean } | null;
export type FormTemplateLike = { id: string; name: string; elements: unknown; active?: boolean } | null | undefined;

/**
 * Templates are additive: built-in fields a template does not mention keep the default mode of the kind (HR adds the
 * built-in with mode `off` to hide it). Unmentioned defaults go first, so the standard fields precede custom blocks.
 */
export function withDefaultBuiltins(elements: FormElement[], kind: VisitKind, flags?: Partial<FormPolicyFlags> | null): FormElement[] {
  const defaults = defaultFormFor(kind, flags).filter((d) => !elements.some((e) => isBuiltin(e) && e.type === d.type));
  return [...defaults, ...elements];
}

/** The form that applies to a kind: the policy's template, else its inline form, else the default. */
export function resolveForm(kind: VisitKind, policy: FormPolicyLike, template?: FormTemplateLike): ResolvedForm {
  if (template && template.active !== false) {
    const elements = parseFormElements(template.elements);
    if (elements) return { elements: withDefaultBuiltins(elements, kind, policy), source: "template", templateId: template.id, templateName: template.name };
  }
  if (policy?.form) {
    const elements = parseFormElements(policy.form);
    if (elements) return { elements: withDefaultBuiltins(elements, kind, policy), source: "inline", templateId: null, templateName: null };
  }
  return { elements: defaultFormFor(kind, policy), source: "default", templateId: null, templateName: null };
}

/** Elements shown on one surface, in order. Built-ins switched off are dropped. */
export function elementsFor(elements: FormElement[], surface: FormSurface): FormElement[] {
  return elements.filter((e) => e.showOn.includes(surface) && !(isBuiltin(e) && e.mode === "off"));
}

/** The built-in element of a type (or null when the form does not mention it). */
export function builtinOf(elements: FormElement[], type: BuiltinType): BuiltinElement | null {
  const e = elements.find((x): x is BuiltinElement => isBuiltin(x) && x.type === type);
  return e ?? null;
}

/** Mode of a built-in field on a surface: `off` when the form hides it there. */
export function builtinMode(elements: FormElement[], type: BuiltinType, surface: FormSurface): FieldMode {
  const e = builtinOf(elements, type);
  if (!e || !e.showOn.includes(surface)) return "off";
  return e.mode;
}

/**
 * Rule for a built-in on the fixed layouts (host invite, kiosk): the form's mode when it lists the surface, else the
 * field stays visible and optional. The visitor page and `evaluatePolicy` use the strict `builtinMode` instead.
 */
export function builtinRule(elements: FormElement[], type: BuiltinType, surface: FormSurface): FieldMode {
  const e = builtinOf(elements, type);
  if (!e || !e.showOn.includes(surface)) return "optional";
  return e.mode;
}

export function isRequired(e: FormElement): boolean {
  if (isBuiltin(e)) return e.mode === "required";
  if (e.type === "question" || e.type === "signature") return e.required;
  return false;
}

// ───────────────────────────── Answers ─────────────────────────────

export type AnswerValue = string | number | boolean;
/** One stored answer: self-describing so reports and badges do not depend on the template still existing. */
export type Answer = { label: string; value: AnswerValue; onBadge?: boolean };
export type Answers = Record<string, Answer>;
/** Shape of `Pass.extra` / `Visit.extra`. */
export type ExtraJson = { answers?: Answers };

/** Field name of a custom question in an HTML form. */
export function fieldName(e: FormElement): string {
  return `q_${e.id}`;
}

export function readAnswers(extra: unknown): Answers {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return {};
  const answers = (extra as ExtraJson).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return {};
  const out: Answers = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!v || typeof v !== "object") continue;
    const a = v as Partial<Answer>;
    if (typeof a.label !== "string") continue;
    if (typeof a.value !== "string" && typeof a.value !== "number" && typeof a.value !== "boolean") continue;
    out[k] = { label: a.label, value: a.value, ...(a.onBadge ? { onBadge: true } : {}) };
  }
  return out;
}

/** Elements (questions, on one surface) whose answers are missing or empty. */
export function missingAnswers(elements: FormElement[], surface: FormSurface, answers: Answers): string[] {
  return elementsFor(elements, surface)
    .filter((e): e is QuestionElement => e.type === "question" && e.required)
    .filter((e) => !hasAnswer(answers[e.id]?.value))
    .map((e) => e.id);
}

export function hasAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "boolean") return value;
  return Number.isFinite(value);
}

/** Minimal FormData-like reader so the collector can run in tests without the DOM. */
export type FormValues = { get(name: string): unknown };

export type CollectedAnswers = { answers: Answers; invalid: string[] };

/**
 * Reads the custom answers of one surface from posted form values. Values are coerced to the question type;
 * anything that does not fit (a number that is not a number, an option that is not offered) is listed in `invalid`.
 * Missing required answers are not an error here: `missingAnswers` / `evaluatePolicy` report them.
 */
export function collectAnswers(elements: FormElement[], surface: FormSurface, values: FormValues): CollectedAnswers {
  const answers: Answers = {};
  const invalid: string[] = [];
  for (const e of elementsFor(elements, surface)) {
    if (e.type !== "question") continue;
    const raw = values.get(fieldName(e));
    const text = typeof raw === "string" ? raw.trim() : "";
    const labelText = e.label ?? e.id;
    const keep = (value: AnswerValue) => {
      answers[e.id] = { label: labelText, value, ...(e.onBadge ? { onBadge: true } : {}) };
    };
    switch (e.questionType) {
      case "checkbox":
        keep(raw === "on" || raw === "true" || raw === "1");
        break;
      case "number": {
        if (text === "") break;
        const n = Number(text.replace(",", "."));
        if (!Number.isFinite(n)) invalid.push(e.id);
        else keep(n);
        break;
      }
      case "select":
        if (text === "") break;
        if (!e.options.includes(text)) invalid.push(e.id);
        else keep(text);
        break;
      default:
        if (text === "") break;
        if (text.length > 500) invalid.push(e.id);
        else keep(text);
    }
  }
  return { answers, invalid };
}

/** Merges new answers over stored ones (the visitor completes what the host left blank, never the other way). */
export function mergeAnswers(stored: Answers, fresh: Answers): Answers {
  return { ...stored, ...fresh };
}

/** Flattens answers for display: `[{ id, label, value }]` in insertion order. */
export function listAnswers(answers: Answers): Array<{ id: string; label: string; value: AnswerValue; onBadge: boolean }> {
  return Object.entries(answers).map(([id, a]) => ({ id, label: a.label, value: a.value, onBadge: Boolean(a.onBadge) }));
}

/** Text for an answer value (booleans use the given words). */
export function formatAnswer(value: AnswerValue, words: { yes: string; no: string }): string {
  if (typeof value === "boolean") return value ? words.yes : words.no;
  return String(value);
}

/** Short, URL-safe id for a new element (editor side; uniqueness is re-checked by the schema). */
export function newElementId(type: ElementType, existing: Iterable<string>): string {
  if ((BUILTIN_TYPES as readonly string[]).includes(type)) return type;
  const taken = new Set(existing);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${type}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${type}${Date.now().toString(36)}`;
}

/** Rendering of the markdown-ish `help`/instructions: paragraphs, `- ` lists and **bold**. */
export type HelpBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export function parseHelp(text: string | undefined | null): HelpBlock[] {
  if (!text) return [];
  const blocks: HelpBlock[] = [];
  let list: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed)) {
      list ??= [];
      list.push(trimmed.replace(/^[-*•]\s+/, ""));
      continue;
    }
    if (list) {
      blocks.push({ kind: "ul", items: list });
      list = null;
    }
    if (trimmed) blocks.push({ kind: "p", text: trimmed });
  }
  if (list) blocks.push({ kind: "ul", items: list });
  return blocks;
}

/** Splits `**bold**` runs for the renderer. */
export function splitBold(text: string): Array<{ bold: boolean; text: string }> {
  const parts: Array<{ bold: boolean; text: string }> = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ bold: false, text: text.slice(last, m.index) });
    parts.push({ bold: true, text: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ bold: false, text: text.slice(last) });
  return parts;
}
