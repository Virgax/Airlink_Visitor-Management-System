"use client";

import { useEffect } from "react";

export type KindFormRules = Record<string, { hidden: string[]; required: string[] }>;

/**
 * Forms that cover every visit kind (host invite, kiosk unannounced) render one `[data-kind-section]` per kind for
 * the custom elements and mark built-in fields with `[data-builtin]`. This switch shows the section of the selected
 * kind (disabling the inputs of the others so they are neither validated nor posted) and applies the built-in
 * modes: hidden when `off`, `required` when the form says so. The server re-validates everything.
 */
export function KindFormSwitch({ selectId, rules }: { selectId: string; rules: KindFormRules }) {
  useEffect(() => {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    const form = select.form ?? document;
    const apply = () => {
      const kind = select.value;
      const rule = rules[kind] ?? { hidden: [], required: [] };
      form.querySelectorAll<HTMLElement>("[data-kind-section]").forEach((section) => {
        const active = section.dataset.kindSection === kind;
        section.hidden = !active;
        section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement>("input, select, textarea, fieldset").forEach((el) => {
          el.disabled = !active;
        });
      });
      form.querySelectorAll<HTMLElement>("[data-builtin]").forEach((box) => {
        const type = box.dataset.builtin ?? "";
        box.hidden = rule.hidden.includes(type);
        box.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((el) => {
          if (el.type === "hidden" || el.type === "checkbox") return;
          el.required = rule.required.includes(type) && !box.hidden;
        });
      });
    };
    apply();
    select.addEventListener("change", apply);
    return () => select.removeEventListener("change", apply);
  }, [selectId, rules]);
  return null;
}
