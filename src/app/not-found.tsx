import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors.notFound");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="muted mt-2">{t("body")}</p>
      <Link href="/" className="btn-primary mt-6">{t("home")}</Link>
    </main>
  );
}
