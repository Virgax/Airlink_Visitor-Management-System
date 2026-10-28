import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/ops/PrintButton";
import { requireMembership } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/notifications/channels/types";
import { selfSignInPath } from "@/lib/server/gates";
import { getManagedSite } from "@/lib/server/sites";

export const dynamic = "force-dynamic";

/** A4 poster for the gate: QR of the public self sign-in URL plus short instructions. Print from the browser. */
export default async function GatePosterPage({ params }: { params: Promise<{ id: string; gateId: string }> }) {
  const { id, gateId } = await params;
  const tenant = await requireMembership("admin", `/admin/sites/${id}/gates/${gateId}/poster`);
  const site = await getManagedSite(tenant, id);
  if (!site) notFound();
  const gate = await db.gate.findFirst({ where: { id: gateId, siteId: site.id }, select: { id: true, name: true, selfSignInToken: true } });
  if (!gate || !gate.selfSignInToken) notFound();
  const t = await getTranslations("ops.selfSignIn.poster");
  const url = absoluteUrl(selfSignInPath(gate.selfSignInToken));
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: "M" });
  const steps = [t("step1"), t("step2"), t("step3")];

  return (
    <div className="space-y-4">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <Link href={`/admin/sites/${site.id}`} className="btn-secondary text-sm">{t("back")}</Link>
        <PrintButton label={t("print")} />
        <span className="muted">{t("help")}</span>
      </div>
      <article className="poster mx-auto flex flex-col items-center gap-6 rounded-xl border border-border bg-white p-10 text-center text-black" data-testid="gate-poster" style={{ width: "210mm", minHeight: "297mm", maxWidth: "100%" }}>
        <div className="flex items-center gap-3" style={{ color: "#111" }}>
          <Logo className="h-12 w-auto" />
          <span className="border-l border-black/30 pl-3 text-2xl">Visitas</span>
        </div>
        <h1 className="text-4xl font-bold">{t("title")}</h1>
        <p className="text-xl">{t("subtitle")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated server side */}
        <img src={dataUrl} alt={t("qrAlt")} width={420} height={420} className="rounded-lg" />
        <p className="text-lg font-medium">{site.name} · {gate.name}</p>
        <ol className="w-full max-w-md space-y-2 text-left text-lg">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ background: "#d7191c" }}>{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-auto text-base" style={{ color: "#555" }}>{t("employees")}</p>
        <p className="break-all text-sm" style={{ color: "#777" }}>{url}</p>
      </article>
    </div>
  );
}
