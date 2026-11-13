import { describe, expect, it } from "vitest";
import {
  builtinMode,
  builtinRule,
  collectAnswers,
  defaultFormFor,
  elementsFor,
  formatAnswer,
  formElementsSchema,
  listAnswers,
  mergeAnswers,
  missingAnswers,
  newElementId,
  parseFormElements,
  parseHelp,
  readAnswers,
  resolveForm,
  splitBold,
  type FormElement,
} from "@/lib/forms/schema";

const question = (over: Partial<Extract<FormElement, { type: "question" }>> = {}): FormElement => ({
  id: "q1", type: "question", label: "Modelo", questionType: "text", options: [], required: true, showOn: ["host", "visitor"], onBadge: false, ...over,
});

function values(map: Record<string, string>) {
  return { get: (name: string) => map[name] };
}

describe("form schema", () => {
  it("accepts a valid element list and applies defaults", () => {
    const parsed = formElementsSchema.parse([{ id: "document", type: "document" }, { id: "q1", type: "question", label: "Modelo" }, { id: "s1", type: "signature" }]);
    expect(parsed[0]).toMatchObject({ mode: "optional", showOn: ["host", "visitor", "kiosk"], onBadge: false });
    expect(parsed[1]).toMatchObject({ questionType: "text", options: [], required: false });
    expect(parsed[2]).toMatchObject({ required: true });
  });
  it("rejects duplicate ids, duplicate built-ins, selects without options and unknown types", () => {
    expect(formElementsSchema.safeParse([{ id: "a", type: "text" }, { id: "a", type: "text" }]).success).toBe(false);
    expect(formElementsSchema.safeParse([{ id: "p", type: "phone" }, { id: "p2", type: "phone" }]).success).toBe(false);
    expect(formElementsSchema.safeParse([{ id: "q", type: "question", questionType: "select" }]).success).toBe(false);
    expect(formElementsSchema.safeParse([{ id: "x", type: "rocket" }]).success).toBe(false);
    expect(formElementsSchema.safeParse([{ id: "bad id!", type: "text" }]).success).toBe(false);
  });
  it("parses stored JSON leniently and returns null for garbage", () => {
    expect(parseFormElements([{ id: "t", type: "text" }])).toHaveLength(1);
    expect(parseFormElements({ elements: [{ id: "t", type: "text" }] })).toHaveLength(1);
    expect(parseFormElements("nope")).toBeNull();
    expect(parseFormElements([{ id: "t" }])).toBeNull();
    expect(parseFormElements(null)).toBeNull();
  });
});

describe("defaultFormFor", () => {
  it("mirrors today's policy flags", () => {
    const visit = defaultFormFor("visit");
    expect(builtinMode(visit, "document", "host")).toBe("required");
    expect(builtinMode(visit, "plate", "host")).toBe("optional");
    expect(builtinMode(visit, "name", "visitor")).toBe("off"); // the visitor never edits the name
    expect(builtinMode(visit, "host", "kiosk")).toBe("required");
    expect(builtinMode(visit, "escort", "host")).toBe("optional"); // escort stays a warning, not a form field
    expect(builtinMode(visit, "document", "kiosk")).toBe("off"); // the kiosk never forced a document on walk-ins
    expect(builtinRule(visit, "document", "kiosk")).toBe("optional"); // …but the field stays on the kiosk form
    expect(builtinRule(visit, "document", "host")).toBe("required");
    expect(builtinRule([], "plate", "kiosk")).toBe("optional");
    expect(builtinRule([{ id: "plate", type: "plate", mode: "off", showOn: ["kiosk"], onBadge: false }], "plate", "kiosk")).toBe("off");
    expect(builtinMode(defaultFormFor("carrier"), "plate", "visitor")).toBe("required");
    expect(builtinMode(defaultFormFor("visit", { requiresDoc: false }), "document", "host")).toBe("optional");
  });
  it("is a valid element list with no custom elements", () => {
    const els = defaultFormFor("contractor");
    expect(formElementsSchema.safeParse(els).success).toBe(true);
    expect(els.every((e) => ["photo", "document", "name", "phone", "email", "company", "plate", "areas", "host", "escort"].includes(e.type))).toBe(true);
  });
});

describe("resolveForm", () => {
  const tpl = { id: "t1", name: "Proveedores L1", elements: [{ id: "document", type: "document", mode: "required" }, question()], active: true };
  it("prefers the template, then the inline form, then the default", () => {
    expect(resolveForm("vendor", { kind: "vendor", form: [{ id: "t", type: "text" }] }, tpl)).toMatchObject({ source: "template", templateId: "t1", templateName: "Proveedores L1" });
    expect(resolveForm("vendor", { kind: "vendor", form: [{ id: "t", type: "text" }] }, null)).toMatchObject({ source: "inline", templateId: null });
    expect(resolveForm("vendor", { kind: "vendor", form: null }, null)).toMatchObject({ source: "default" });
    expect(resolveForm("vendor", null)).toMatchObject({ source: "default" });
  });
  it("skips an inactive template and an invalid inline form", () => {
    expect(resolveForm("vendor", { kind: "vendor" }, { ...tpl, active: false }).source).toBe("default");
    expect(resolveForm("vendor", { kind: "vendor", form: { nope: true } }, null).source).toBe("default");
    expect(resolveForm("vendor", { kind: "vendor", form: [{ id: "x" }] }, null).source).toBe("default");
  });
  it("keeps the default mode of built-ins a template does not mention, ahead of the template's elements", () => {
    const r = resolveForm("vendor", { kind: "vendor" }, tpl);
    expect(r.elements.map((e) => e.id)).toEqual(["name", "company", "phone", "email", "plate", "areas", "host", "escort", "photo", "document", "q1"]);
    expect(builtinMode(r.elements, "document", "host")).toBe("required");
    expect(builtinMode(r.elements, "name", "host")).toBe("required");
    const hidden = resolveForm("vendor", { kind: "vendor" }, { ...tpl, elements: [{ id: "phone", type: "phone", mode: "off" }] });
    expect(builtinMode(hidden.elements, "phone", "host")).toBe("off");
    expect(builtinMode(hidden.elements, "document", "host")).toBe("required");
  });
  it("default honours the policy's requiresDoc", () => {
    const r = resolveForm("visit", { kind: "visit", requiresDoc: false, escortRequired: false, requiresNda: false });
    expect(builtinMode(r.elements, "document", "host")).toBe("optional");
  });
});

describe("elementsFor / builtinMode", () => {
  const els: FormElement[] = [
    { id: "document", type: "document", mode: "off", showOn: ["host", "visitor", "kiosk"], onBadge: false },
    { id: "phone", type: "phone", mode: "required", showOn: ["visitor"], onBadge: false },
    question({ showOn: ["kiosk"] }),
  ];
  it("drops switched-off built-ins and elements of other surfaces", () => {
    expect(elementsFor(els, "host").map((e) => e.id)).toEqual([]);
    expect(elementsFor(els, "visitor").map((e) => e.id)).toEqual(["phone"]);
    expect(elementsFor(els, "kiosk").map((e) => e.id)).toEqual(["q1"]);
    expect(builtinMode(els, "phone", "host")).toBe("off");
    expect(builtinMode(els, "phone", "visitor")).toBe("required");
    expect(builtinMode(els, "email", "visitor")).toBe("off");
  });
});

describe("collectAnswers", () => {
  const els: FormElement[] = [
    question({ id: "model", label: "Modelo", questionType: "text" }),
    question({ id: "units", label: "Unidades", questionType: "number", required: false }),
    question({ id: "area", label: "Área", questionType: "select", options: ["IQC", "Almacén"] }),
    question({ id: "ppe", label: "Trae EPP", questionType: "checkbox", onBadge: true }),
    question({ id: "kioskOnly", label: "Solo kiosco", showOn: ["kiosk"] }),
    { id: "t", type: "text", label: "Instrucciones", showOn: ["host"], onBadge: false },
  ];
  it("coerces by question type and keeps labels with the answers", () => {
    const { answers, invalid } = collectAnswers(els, "host", values({ q_model: " iPhone 15 ", q_units: "12,5", q_area: "IQC", q_ppe: "on", q_kioskOnly: "ignored" }));
    expect(invalid).toEqual([]);
    expect(answers).toEqual({
      model: { label: "Modelo", value: "iPhone 15" },
      units: { label: "Unidades", value: 12.5 },
      area: { label: "Área", value: "IQC" },
      ppe: { label: "Trae EPP", value: true, onBadge: true },
    });
  });
  it("flags values that do not fit and leaves empty answers out", () => {
    const { answers, invalid } = collectAnswers(els, "host", values({ q_units: "doce", q_area: "Cocina" }));
    expect(invalid).toEqual(["units", "area"]);
    expect(answers).toEqual({ ppe: { label: "Trae EPP", value: false, onBadge: true } });
  });
  it("reports missing required answers per surface", () => {
    const answers = collectAnswers(els, "host", values({ q_model: "x", q_area: "IQC", q_ppe: "on" })).answers;
    expect(missingAnswers(els, "host", answers)).toEqual([]);
    expect(missingAnswers(els, "kiosk", answers)).toEqual(["kioskOnly"]);
    expect(missingAnswers(els, "host", {})).toEqual(["model", "area", "ppe"]);
  });
  it("merges visitor answers over the host's and reads stored JSON defensively", () => {
    const merged = mergeAnswers({ model: { label: "Modelo", value: "A" }, ppe: { label: "EPP", value: false } }, { ppe: { label: "EPP", value: true } });
    expect(merged.ppe?.value).toBe(true);
    expect(merged.model?.value).toBe("A");
    expect(readAnswers({ answers: { ok: { label: "L", value: 1 }, bad: { value: "no label" }, worse: "x" } })).toEqual({ ok: { label: "L", value: 1 } });
    expect(readAnswers(null)).toEqual({});
    expect(readAnswers([1, 2])).toEqual({});
    expect(listAnswers(merged).map((a) => a.id)).toEqual(["model", "ppe"]);
    expect(formatAnswer(true, { yes: "Sí", no: "No" })).toBe("Sí");
    expect(formatAnswer(3, { yes: "Sí", no: "No" })).toBe("3");
  });
});

describe("editor helpers", () => {
  it("gives built-ins their type as id and numbers custom elements", () => {
    expect(newElementId("document", [])).toBe("document");
    expect(newElementId("question", ["question1", "question2"])).toBe("question3");
    expect(newElementId("text", [])).toBe("text1");
  });
  it("parses markdown-ish help", () => {
    expect(parseHelp("Trae tu **cédula**.\n- Casco\n- Botas\n\nGracias")).toEqual([
      { kind: "p", text: "Trae tu **cédula**." },
      { kind: "ul", items: ["Casco", "Botas"] },
      { kind: "p", text: "Gracias" },
    ]);
    expect(splitBold("Trae tu **cédula** hoy")).toEqual([{ bold: false, text: "Trae tu " }, { bold: true, text: "cédula" }, { bold: false, text: " hoy" }]);
    expect(parseHelp("")).toEqual([]);
  });
});

describe("built-in surface rules", () => {
  it("rejects name/host built-ins switched off", () => {
    const r = formElementsSchema.safeParse([{ id: "b1", type: "name", mode: "off", showOn: ["host"], onBadge: false }]);
    expect(r.success).toBe(false);
  });

  it("lists the surfaces that can collect each built-in", async () => {
    const { BUILTIN_SURFACES, builtinCollectableOn } = await import("@/lib/forms/schema");
    expect(BUILTIN_SURFACES.email).not.toContain("kiosk");
    expect(builtinCollectableOn("areas", "visitor")).toBe(false);
    expect(builtinCollectableOn("document", "kiosk")).toBe(true);
  });
});

describe("list questions and English texts", () => {
  it("stores one item per line and rejects an oversized list", async () => {
    const { collectAnswers } = await import("@/lib/forms/schema");
    const form: FormElement[] = [{ id: "tools", type: "question", label: "Herramientas", questionType: "list", options: [], required: true, showOn: ["visitor"], onBadge: false }];
    const ok = collectAnswers(form, "visitor", values({ q_tools: " Escalera \r\n\nTaladro\n  " }));
    expect(ok.invalid).toEqual([]);
    expect(ok.answers.tools?.value).toBe("Escalera\nTaladro");
    const empty = collectAnswers(form, "visitor", values({ q_tools: "\n \n" }));
    expect(empty.answers.tools).toBeUndefined();
    const big = collectAnswers(form, "visitor", values({ q_tools: Array.from({ length: 300 }, (_, i) => `item ${i} xxxxxxxxxx`).join("\n") }));
    expect(big.invalid).toEqual(["tools"]);
  });

  it("falls back to the Spanish text when no English text is set", async () => {
    const { elementText, formElementsSchema } = await import("@/lib/forms/schema");
    const el = { id: "t1", type: "text", label: "Normas", help: "Sin shorts", labelEn: "Rules", showOn: ["visitor"], onBadge: false } as const;
    expect(formElementsSchema.safeParse([el]).success).toBe(true);
    expect(elementText(el, "en")).toEqual({ label: "Rules", help: "Sin shorts" });
    expect(elementText(el, "es")).toEqual({ label: "Normas", help: "Sin shorts" });
    expect(elementText(el)).toEqual({ label: "Normas", help: "Sin shorts" });
  });
});

describe("personal devices block", () => {
  const form: FormElement[] = [{ id: "dev", type: "devices", required: true, kinds: ["phone", "laptop"], showOn: ["host", "visitor", "kiosk"], onBadge: false }];
  const multi = (map: Record<string, string[] | string>) => ({ get: (n: string) => (Array.isArray(map[n]) ? map[n]![0] : map[n]), getAll: (n: string) => (Array.isArray(map[n]) ? map[n]! : map[n] ? [map[n]!] : []) });

  it("collects rows with a normalised IMEI, skipping empty rows and duplicates", async () => {
    const { collectDevices } = await import("@/lib/forms/schema");
    const r = collectDevices(form, "visitor", multi({ dev_kind: ["phone", "laptop", "phone"], dev_id: [" 35-123456 789012-3 ", "", "351234567890123"], dev_model: ["iPhone 15", "", "x"], dev_color: ["negro", "", ""] }));
    expect(r.invalid).toBe(false);
    expect(r.present).toBe(true);
    expect(r.devices).toEqual([{ kind: "phone", id: "351234567890123", model: "iPhone 15", color: "negro" }]);
  });

  it("flags a kind the form does not allow or a bad id, and reads the none declaration", async () => {
    const { collectDevices, devicesSatisfied, readDevices, readDevicesNone } = await import("@/lib/forms/schema");
    expect(collectDevices(form, "visitor", multi({ dev_kind: ["watch"], dev_id: ["ABCDE12345"] })).invalid).toBe(true);
    expect(collectDevices(form, "visitor", multi({ dev_kind: ["phone"], dev_id: ["123"] })).invalid).toBe(true);
    const none = collectDevices(form, "visitor", multi({ dev_none: "on" }));
    expect(none).toMatchObject({ devices: [], none: true, invalid: false });
    expect(collectDevices(form, "host", multi({})).present).toBe(true);
    expect(collectDevices([], "host", multi({})).present).toBe(false);
    expect(devicesSatisfied([], false)).toBe(false);
    expect(devicesSatisfied([], true)).toBe(true);
    expect(readDevices({ devices: [{ kind: "laptop", id: "SN1", model: "Dell", color: "gris" }, { kind: "nope", id: "x" }] })).toEqual([{ kind: "laptop", id: "SN1", model: "Dell", color: "gris" }]);
    expect(readDevicesNone({ devicesNone: true })).toBe(true);
  });

  it("is a required field for policy evaluation", async () => {
    const { missingFormFields } = await import("@/lib/policies/evaluate");
    expect(missingFormFields(form, "visitor", { kind: "vendor", form })).toEqual(["dev"]);
    expect(missingFormFields(form, "visitor", { kind: "vendor", form, devicesNone: true })).toEqual([]);
    expect(missingFormFields(form, "visitor", { kind: "vendor", form, devices: [{ kind: "phone", id: "351234567890123", model: "", color: "" }] })).toEqual([]);
  });
});

describe("face photo policy flag", () => {
  it("makes the photo required on the visitor link and the kiosk when the policy asks for it", async () => {
    const { builtinMode, defaultFormFor } = await import("@/lib/forms/schema");
    const plain = defaultFormFor("visit");
    expect(builtinMode(plain, "photo", "visitor")).toBe("optional");
    expect(builtinMode(plain, "photo", "host")).toBe("off");
    const strict = defaultFormFor("visit", { requiresPhoto: true });
    expect(builtinMode(strict, "photo", "visitor")).toBe("required");
    expect(builtinMode(strict, "photo", "kiosk")).toBe("required");
  });
});
