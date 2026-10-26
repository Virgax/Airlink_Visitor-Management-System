import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Icon } from "@/components/Icon";

/** Title row of a kiosk screen with the way back to the kiosk home. */
export async function KioskBar({ title, children }: { title: string; children?: React.ReactNode }) {
  const t = await getTranslations("app");
  return (
    <div className="print-hidden mb-4 flex flex-wrap items-center gap-3">
      <Link href="/guard" className="btn-secondary px-2 py-2" aria-label={t("back")} title={t("back")}>
        <Icon icon={ArrowLeft} />
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
