import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth/session";
import { fmtDate } from "@/lib/format";

export default async function PrivacyPage() {
  const user = await getSessionUser();
  const t = await getTranslations("legal.privacy");
  const locale = await getLocale();
  return (
    <AppShell user={user} title={t("title")}>
      <article className="prose max-w-3xl space-y-4 text-text">
        <p className="muted">{t("updated", { date: fmtDate(new Date("2026-10-26"), locale, { dateStyle: "long", timeStyle: undefined }) })}</p>
        <p>Airlink Distribution DR («Airlink») trata los datos personales de visitantes y empleados en Airlink Visitas con la única finalidad de controlar el acceso a sus instalaciones y garantizar la seguridad de personas y bienes, conforme a la Ley 172-13 sobre protección de datos personales de la República Dominicana.</p>
        <h2 className="text-lg font-semibold">Datos que tratamos</h2>
        <p>Nombre, empresa, teléfono o correo si los proporcionas, los últimos cuatro dígitos y un código derivado (no reversible) de tu documento de identidad, placa del vehículo, hora de entrada y salida, área visitada y anfitrión. Si el sitio lo tiene activado, una fotografía del documento o del visitante.</p>
        <h2 className="text-lg font-semibold">Conservación</h2>
        <p>Los registros de acceso se conservan por el plazo configurado por Seguridad (90 días por defecto para fotografías) y se eliminan automáticamente al vencer. Los registros de bitácora pueden conservarse más tiempo como evidencia de auditoría.</p>
        <h2 className="text-lg font-semibold">Tus derechos</h2>
        <p>Puedes solicitar acceso, rectificación o eliminación de tus datos escribiendo a IT de Airlink Distribution DR desde la recepción de cualquier sitio.</p>
      </article>
    </AppShell>
  );
}
