import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { IdCard, UserRound } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { PersonPicker } from "@/components/ops/PersonPicker";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { loadSelfSignInGate } from "@/lib/server/self-signin";
import { employeePresenceAction, searchPeopleAction, selfSignInAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = { mode?: string; ok?: string; error?: string };
const VISITOR_ERRORS = ["invalid", "host", "reception", "rateLimited"];
const EMPLOYEE_ERRORS = ["invalid", "employee", "noPin", "pin", "rateLimited"];

/**
 * Public self sign-in page behind the gate QR poster. No session: the gate token in the URL is the only key.
 * Two modes (query `mode`, so the page stays a server component): walk-in visitor, or employee check-in by PIN.
 */
export default async function SelfSignInPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Search> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ip = clientIp(await headers()) ?? "unknown";
  const limit = await rateLimit(`self-view:ip:${ip}`, 60, 60);
  if (!limit.ok) notFound();
  const gate = await loadSelfSignInGate(token);
  if (!gate) notFound();
  const t = await getTranslations("ops.selfSignIn");
  const tk = await getTranslations("admin.kinds");
  const employeeMode = sp.mode === "employee";
  const base = `/s/${encodeURIComponent(token)}`;
  const errorKey = sp.error && (employeeMode ? EMPLOYEE_ERRORS : VISITOR_ERRORS).includes(sp.error) ? sp.error : null;
  const okKey = employeeMode && (sp.ok === "in" || sp.ok === "out") ? sp.ok : null;
  const search = searchPeopleAction.bind(null, token);
  const pickerLabels = (prefix: "host" | "employee") => ({
    label: t(`${prefix}.label`),
    placeholder: t(`${prefix}.placeholder`),
    help: t(`${prefix}.help`),
    searching: t("picker.searching"),
    none: t("picker.none"),
    selected: t(`${prefix}.selected`),
    change: t("picker.change"),
  });

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
        <nav aria-label={t("modes")} className="grid grid-cols-2 gap-2" data-testid="self-modes">
          <Link href={base} className={employeeMode ? "btn-secondary justify-center" : "btn-primary justify-center"} aria-current={employeeMode ? undefined : "page"}>
            <Icon icon={UserRound} /> {t("visitorTab")}
          </Link>
          <Link href={`${base}?mode=employee`} className={employeeMode ? "btn-primary justify-center" : "btn-secondary justify-center"} aria-current={employeeMode ? "page" : undefined}>
            <Icon icon={IdCard} /> {t("employeeTab")}
          </Link>
        </nav>
        {okKey ? <p className="alert-ok" role="status" data-testid="self-ok">{t(`employee.ok.${okKey}`)}</p> : null}
        {errorKey ? <p className="alert-error" role="alert" data-testid="self-error">{t(`${employeeMode ? "employee" : "visitor"}.errors.${errorKey}` as "visitor.errors.invalid")}</p> : null}

        {employeeMode ? (
          <form action={employeePresenceAction} className="space-y-4" data-testid="employee-form">
            <input type="hidden" name="token" value={token} />
            <p className="muted">{t("employee.intro")}</p>
            <PersonPicker name="employeeId" search={search} labels={pickerLabels("employee")} inputId="employeeSearch" />
            <div>
              <label className="label" htmlFor="pin">{t("employee.pin")}</label>
              <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={12} className="input" />
              <p className="muted mt-1 text-xs">{t("employee.pinHelp")}</p>
            </div>
            <button type="submit" className="btn-primary w-full">{t("employee.submit")}</button>
          </form>
        ) : gate.kinds.length === 0 ? (
          <p className="alert-error" role="alert">{t("visitor.noKinds")}</p>
        ) : (
          <form action={selfSignInAction} className="space-y-4" data-testid="visitor-form">
            <input type="hidden" name="token" value={token} />
            <p className="muted">{t("visitor.intro")}</p>
            <div>
              <label className="label" htmlFor="visitorName">{t("visitor.name")}</label>
              <input id="visitorName" name="visitorName" required minLength={2} maxLength={120} autoComplete="name" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="company">{t("visitor.company")}</label>
              <input id="company" name="company" maxLength={120} autoComplete="organization" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="kind">{t("visitor.kind")}</label>
              <select id="kind" name="kind" className="input" defaultValue={gate.kinds.includes("visit") ? "visit" : gate.kinds[0]}>
                {gate.kinds.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
              </select>
            </div>
            <PersonPicker name="hostEmployeeId" search={search} labels={pickerLabels("host")} inputId="hostSearch" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="doc">{t("visitor.doc")}</label>
                <input id="doc" name="doc" maxLength={40} autoComplete="off" inputMode="numeric" className="input" aria-describedby="doc-help" />
                <p id="doc-help" className="muted mt-1 text-xs">{t("visitor.docHelp")}</p>
              </div>
              <div>
                <label className="label" htmlFor="phone">{t("visitor.phone")}</label>
                <input id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className="input" />
              </div>
            </div>
            <button type="submit" className="btn-primary w-full">{t("visitor.submit")}</button>
            <p className="muted text-xs">{t("visitor.privacy")}</p>
          </form>
        )}
      </div>
    </main>
  );
}
