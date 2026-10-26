import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ClipboardList, Lock, QrCode, ScanLine, Siren, UserPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/db";
import { getDevice } from "@/lib/auth/kiosk";
import { getSessionUser } from "@/lib/auth/session";
import { enrollAction, lockAction, pinLoginAction } from "./actions";

export default async function GuardPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("guard");
  const device = await getDevice();

  if (!device) {
    return (
      <AppShell user={null} kiosk>
        <div className="mx-auto max-w-md">
          <form action={enrollAction} className="card space-y-4">
            <h1 className="text-2xl font-semibold">{t("enroll.title")}</h1>
            <p className="muted">{t("enroll.intro")}</p>
            {sp.error === "enroll" ? <p className="alert-error" role="alert">{t("enroll.error")}</p> : null}
            <div>
              <label className="label" htmlFor="code">{t("enroll.code")}</label>
              <input id="code" name="code" required autoComplete="off" autoCapitalize="characters" className="input font-mono text-lg tracking-widest" />
            </div>
            <button type="submit" className="btn-primary w-full">{t("enroll.submit")}</button>
          </form>
        </div>
      </AppShell>
    );
  }

  const user = await getSessionUser();
  const kioskSession = user && user.guardDeviceId === device.id ? user : null;

  if (!kioskSession) {
    const guards = await db.user.findMany({
      where: { status: "active", pinHash: { not: null }, memberships: { some: { role: "security", status: "active", OR: [{ siteId: device.siteId }, { siteId: null }] } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const errorKey = sp.error === "pin" ? "pin.error" : sp.error === "rateLimited" ? "pin.rateLimited" : null;
    return (
      <AppShell user={null} kiosk>
        <div className="mx-auto max-w-md">
          <form action={pinLoginAction} className="card space-y-4">
            <h1 className="text-2xl font-semibold">{t("pin.title")}</h1>
            <p className="muted">{t("pin.device", { device: device.name, site: device.site.name, gate: device.gate.name })}</p>
            {errorKey ? <p className="alert-error" role="alert">{t(errorKey)}</p> : null}
            {guards.length === 0 ? (
              <p className="alert-error">{t("pin.noGuards")}</p>
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="userId">{t("pin.who")}</label>
                  <select id="userId" name="userId" className="input" required>
                    {guards.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="pin">{t("pin.pin")}</label>
                  <input id="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" required autoComplete="off" className="input text-2xl tracking-widest" />
                </div>
                <button type="submit" className="btn-primary w-full">{t("pin.submit")}</button>
              </>
            )}
          </form>
        </div>
      </AppShell>
    );
  }

  const actions = [
    { icon: ScanLine, label: t("kiosk.scan") },
    { icon: UserPlus, label: t("kiosk.unannounced") },
    { icon: QrCode, label: t("kiosk.inside") },
    { icon: Siren, label: t("kiosk.evacuation") },
    { icon: ClipboardList, label: t("kiosk.log"), href: "/guard/log" },
  ];
  return (
    <AppShell user={kioskSession} kiosk subtitle={device.site.name}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t("kiosk.title")}</h1>
        <p className="muted">{t("kiosk.signedInAs", { name: kioskSession.name, gate: device.gate.name })}</p>
        <form action={lockAction} className="ml-auto">
          <button type="submit" className="btn-secondary"><Icon icon={Lock} /> {t("kiosk.lock")}</button>
        </form>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {actions.map((a) =>
          a.href ? (
            <li key={a.label}>
              <Link href={a.href} className="card flex min-h-32 flex-col items-center justify-center gap-2 text-center hover:bg-surface-2">
                <Icon icon={a.icon} size={28} />
                <span className="font-medium">{a.label}</span>
              </Link>
            </li>
          ) : (
            <li key={a.label} className="card flex min-h-32 flex-col items-center justify-center gap-2 text-center opacity-70">
              <Icon icon={a.icon} size={28} />
              <span className="font-medium">{a.label}</span>
              <span className="muted text-xs">{t("kiosk.title") === "" ? "" : "Fase 1"}</span>
            </li>
          ),
        )}
      </ul>
    </AppShell>
  );
}
