import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/Logo";
import { SelfSignInStatus, type SelfSignInStatusLabels, type SelfVisitStatus } from "@/components/ops/SelfSignInStatus";
import { clientIp } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { loadSelfSignInGate, selfVisitJson, selfVisitSelect, verifyVisitKey } from "@/lib/server/self-signin";

export const dynamic = "force-dynamic";

const STATUSES: SelfVisitStatus[] = ["pending", "approved", "denied", "inside", "at_dock", "left", "timeout"];

/** Visitor-facing status page after the self sign-in: "we told your host…", approved, denied. Polls every 4 s. */
export default async function SelfVisitStatusPage({ params, searchParams }: { params: Promise<{ token: string; visitId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { token, visitId } = await params;
  const { k } = await searchParams;
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`self-view:ip:${ip}`, 60, 60);
  if (!limit.ok) notFound();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(visitId) || !(await verifyVisitKey(k, visitId))) notFound();
  const gate = await loadSelfSignInGate(token);
  if (!gate) notFound();
  const visit = await db.visit.findFirst({ where: { id: visitId, siteId: gate.site.id }, select: selfVisitSelect });
  if (!visit) notFound();
  const t = await getTranslations("ops.selfSignIn.status");
  const json = selfVisitJson(visit);
  const status = STATUSES.includes(json.status as SelfVisitStatus) ? (json.status as SelfVisitStatus) : "pending";
  const args = { host: json.hostName ?? t("yourHost"), gate: json.gateName };
  const labels = Object.fromEntries(STATUSES.map((s) => [s, { title: t(`${s}.title`, args), body: t(`${s}.body`, args) }])) as Record<SelfVisitStatus, { title: string; body: string }>;
  const allLabels: SelfSignInStatusLabels = { ...labels, network: t("network") };
  const pollUrl = `/api/s/visits/${encodeURIComponent(visitId)}?k=${encodeURIComponent(k ?? "")}`;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-auto" />
          <span className="border-l border-border pl-3 text-text-muted">Visitas</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="muted">{gate.site.name} · {gate.name}</p>
        </div>
        <p className="text-xl" data-testid="self-visitor">{json.visitorName}</p>
        <SelfSignInStatus initial={{ ...json, status }} pollUrl={pollUrl} labels={allLabels} />
        <p className="muted">{t("refresh", { seconds: 4 })}</p>
        <Link href={`/s/${encodeURIComponent(token)}`} className="btn-secondary text-sm">{t("another")}</Link>
      </div>
    </main>
  );
}
