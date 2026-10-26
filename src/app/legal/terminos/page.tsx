import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";

export default async function TermsPage() {
  const user = await getSessionUser();
  const t = await getTranslations("legal.terms");
  const locale = await getLocale();
  return (
    <AppShell user={user} title={t("title")}>
      <article className="max-w-3xl space-y-4 text-text">
        <p className="muted">{t("updated", { date: fmtDate(new Date("2026-10-26"), locale, { dateStyle: "long", timeStyle: undefined }) })}</p>
        <p>Airlink Visitas es una herramienta interna de Airlink Distribution DR para el control de visitantes. Su uso por empleados se rige por las políticas internas de seguridad y de uso aceptable de sistemas de la empresa.</p>
        <p>Los visitantes que reciben un pase aceptan presentar un documento de identidad válido en seguridad, portar el gafete visible, seguir las indicaciones del personal de seguridad y cumplir la política de visitantes vigente, incluida la prohibición de fotografías y la confidencialidad de lo observado dentro de la planta.</p>
      </article>
    </AppShell>
  );
}
