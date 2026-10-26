import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/auth/session";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

/** Public pass page. Shows only what the visitor needs; never the host's contact details. */
export default async function VisitorPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`pass-view:ip:${ip}`, 60, 60);
  if (!limit.ok) notFound();

  const pass = await db.pass.findUnique({
    where: { token },
    include: { site: { select: { name: true, address: true, timezone: true } }, host: { select: { name: true, department: true } }, company: { select: { name: true } } },
  });
  if (!pass) notFound();
  const t = await getTranslations("visitor");
  const locale = await getLocale();
  const tz = pass.site.timezone;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-8">
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-auto" />
          <span className="border-l border-border pl-3 text-text-muted">Visitas</span>
        </div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-xl">{pass.visitorName}{pass.company ? <span className="muted"> · {pass.company.name}</span> : null}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="muted">{t("site")}</dt><dd>{pass.site.name}{pass.site.address ? ` · ${pass.site.address}` : ""}</dd>
          <dt className="muted">{t("host")}</dt><dd>{pass.host.name}{pass.host.department ? ` · ${pass.host.department}` : ""}</dd>
          <dt className="muted">{t("from")}</dt><dd>{fmtDate(pass.validFrom, locale, { timeZone: tz })}</dd>
          <dt className="muted">{t("until")}</dt><dd>{fmtDate(pass.validUntil, locale, { timeZone: tz })}</dd>
        </dl>
        <p className={`rounded-lg px-3 py-2 text-sm ${pass.status === "active" ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}>{t(`status.${pass.status}`)}</p>
        <p className="muted">{t("qrSoon")}</p>
        <p className="muted">{t("instructions")}</p>
        <p className="muted text-xs">{t("privacy")} <Link href="/legal/privacidad" className="underline">/legal/privacidad</Link></p>
      </div>
    </main>
  );
}
