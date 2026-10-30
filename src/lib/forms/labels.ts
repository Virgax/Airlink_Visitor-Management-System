import "server-only";
import { getTranslations } from "next-intl/server";
import type { FormLabels } from "@/components/forms/FormFields";

/** Renderer labels in the reader's language (`forms.render.*`) for server-rendered forms. */
export async function formLabels(): Promise<FormLabels> {
  const t = await getTranslations("forms.render");
  return {
    required: t("required"),
    choose: t("choose"),
    openDocument: t("openDocument"),
    mediaMissing: t("mediaMissing"),
    listPlaceholder: t("listPlaceholder"),
    signature: { draw: t("signature.draw"), clear: t("signature.clear"), typedName: t("signature.typedName"), typedNameHelp: t("signature.typedNameHelp"), drawn: t("signature.drawn") },
  };
}
