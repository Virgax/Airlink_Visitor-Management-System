"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors.generic");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="muted mt-2">{t("body")}</p>
      <button type="button" onClick={reset} className="btn-primary mt-6">{t("retry")}</button>
    </main>
  );
}
