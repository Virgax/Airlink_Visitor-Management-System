import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { MembershipRole } from "@prisma/client";
import { ArrowLeft, KeyRound, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { Icon } from "@/components/Icon";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { requireMembership } from "@/lib/auth/guards";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { loadPersonDetail } from "@/lib/server/people-admin";
import { addMembershipAction, deletePersonAction, editPersonAction, removeMembershipAction, setPasswordAction, setPinAction } from "../actions";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "security", "approver", "warden"] as const satisfies readonly MembershipRole[];
const OK_KEYS = ["saved", "roleOn", "roleOff", "password", "pinSet"];
const ERROR_KEYS = ["invalid", "exists", "forbidden", "synced", "needEmail", "noEmail", "self", "password", "mismatch", "hasHistory", "pin", "weakPin"];

/** One person: data (manual rows), roles per site, access (password, PIN) and deletion. */
export default async function PersonEditPage({ searchParams }: { searchParams: Promise<{ key?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireMembership("admin", "/admin/people");
  const person = await loadPersonDetail(tenant, sp.key);
  if (!person) notFound();
  const t = await getTranslations("people.edit");
  const td = await getTranslations("people.directory");
  const tr = await getTranslations("roles");
  const tc = await getTranslations("admin.common");
  const isGlobal = tenant.membership.siteId === null;
  const e = person.employee;
  const u = person.user;
  const name = e?.name ?? u?.name ?? "";
  const email = e?.email ?? u?.email ?? null;
  const manual = !e || e.source === "manual";
  const ok = sp.ok && OK_KEYS.includes(sp.ok) ? sp.ok : null;
  const error = sp.error && ERROR_KEYS.includes(sp.error) ? sp.error : null;
  const hidden = <input type="hidden" name="key" value={person.key} />;
  const isSelf = u?.id === tenant.user.id;

  return (
    <div className="space-y-6" data-testid="person-edit">
      <div>
        <Link href="/admin/people" className="muted inline-flex items-center gap-1 text-sm hover:underline"><Icon icon={ArrowLeft} size={16} /> {t("back")}</Link>
        <h1 className="mt-2 text-2xl font-semibold">{name}</h1>
        <p className="muted">{email ?? td("roleNeedsEmail")} · {e ? td(`source.${e.source}`) : td("source.user")}{e && !e.active ? ` · ${tc("inactive")}` : ""}</p>
      </div>
      {ok ? <p className="alert-ok" role="status">{t(`ok.${ok as "saved"}`)}</p> : null}
      {error ? <p className="alert-error" role="alert">{t(`errors.${error as "invalid"}`)}</p> : null}

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon icon={UserCog} /> {t("data")}</h2>
        {!manual ? <p className="muted">{t("syncedNote")}</p> : null}
        <form action={editPersonAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hidden}
          <fieldset disabled={!manual} className="contents">
            <div>
              <label className="label" htmlFor="name">{td("name")}</label>
              <input id="name" name="name" required minLength={2} maxLength={120} className="input" defaultValue={name} />
            </div>
            <div>
              <label className="label" htmlFor="email">{td("email")}</label>
              <input id="email" name="email" type="email" maxLength={200} className="input" defaultValue={email ?? ""} required={Boolean(u)} />
            </div>
            {e ? (
              <>
                <div>
                  <label className="label" htmlFor="department">{td("department")}</label>
                  <input id="department" name="department" maxLength={80} className="input" defaultValue={e.department ?? ""} />
                </div>
                <div>
                  <label className="label" htmlFor="extension">{td("extension")}</label>
                  <input id="extension" name="extension" maxLength={20} className="input" defaultValue={e.extension ?? ""} />
                </div>
                <div>
                  <label className="label" htmlFor="phone">{td("phone")}</label>
                  <input id="phone" name="phone" maxLength={30} className="input" defaultValue={e.phone ?? ""} />
                </div>
                <div>
                  <label className="label" htmlFor="siteId">{td("site")}</label>
                  <select id="siteId" name="siteId" className="input" defaultValue={e.siteId ?? ""}>
                    {isGlobal ? <option value="">{td("noSite")}</option> : null}
                    {tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </>
            ) : null}
            <div className="sm:col-span-2 lg:col-span-3">
              <button type="submit" className="btn-primary" data-testid="save-person">{tc("save")}</button>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon icon={ShieldCheck} /> {t("roles")}</h2>
        <p className="muted">{t("rolesHelp")}</p>
        {e ? <p className="text-sm"><span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">{td("roles.host")}</span> <span className="muted">{t("hostNote")}</span></p> : null}
        {u && u.memberships.length ? (
          <ul className="divide-y divide-border" data-testid="memberships">
            {u.memberships.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2" data-role={m.role} data-site={m.siteId ?? "all"}>
                <span className="font-medium">{tr(m.role as "admin")}</span>
                <span className="muted">{m.siteName ?? td("allSites")}{m.status !== "active" ? ` · ${tc("inactive")}` : ""}</span>
                <form action={removeMembershipAction} className="ml-auto">
                  {hidden}
                  <input type="hidden" name="membershipId" value={m.id} />
                  <ConfirmSubmit message={t("removeRoleConfirm", { role: tr(m.role as "admin"), scope: m.siteName ?? td("allSites") })} className="btn-secondary text-danger text-xs" data-testid="remove-role">{t("removeRole")}</ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noRoles")}</p>
        )}
        <form action={addMembershipAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-3">
          {hidden}
          <div>
            <label className="label" htmlFor="role">{t("addRole")}</label>
            <select id="role" name="role" className="input text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="roleSiteId">{t("addRoleSite")}</label>
            <select id="roleSiteId" name="siteId" className="input text-sm" defaultValue={tenant.site?.id ?? ""}>
              {isGlobal ? <option value="">{td("allSites")}</option> : null}
              {tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-secondary text-sm" disabled={!email} data-testid="add-role">{t("addRoleButton")}</button>
          {!email ? <span className="muted text-xs">{td("roleNeedsEmail")}</span> : null}
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon icon={KeyRound} /> {t("access")}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={setPasswordAction} className="space-y-2 rounded-lg bg-surface-2 p-3">
            {hidden}
            <h3 className="font-medium">{t("password")}</h3>
            <p className="muted text-sm">{u?.hasPassword ? t("passwordHas") : t("passwordNone")}{u?.hasTotp ? ` ${t("totpOn")}` : ""}</p>
            <div>
              <label className="label" htmlFor="password">{t("newPassword", { min: PASSWORD_MIN_LENGTH })}</label>
              <input id="password" name="password" type="password" minLength={PASSWORD_MIN_LENGTH} maxLength={200} required className="input" autoComplete="new-password" />
            </div>
            <div>
              <label className="label" htmlFor="confirm">{t("confirmPassword")}</label>
              <input id="confirm" name="confirm" type="password" minLength={PASSWORD_MIN_LENGTH} maxLength={200} required className="input" autoComplete="new-password" />
            </div>
            {u?.hasTotp ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="resetTotp" /> {t("resetTotp")}</label> : null}
            <button type="submit" className="btn-secondary text-sm" disabled={!email} data-testid="set-password">{t("setPassword")}</button>
            <p className="muted text-xs">{t("passwordHelp")}</p>
          </form>
          <form action={setPinAction} className="space-y-2 rounded-lg bg-surface-2 p-3">
            {hidden}
            <input type="hidden" name="return" value="edit" />
            <h3 className="font-medium">{td("pinLabel", { name })}</h3>
            <p className="muted text-sm">{(e?.hasPin || u?.hasPin) ? td("pinOn") : td("pinOff")} · {td("pinHelp")}</p>
            <div>
              <label className="label" htmlFor="pin">{td("pinPlaceholder")}</label>
              <input id="pin" name="pin" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} required className="input" autoComplete="off" />
            </div>
            <button type="submit" className="btn-secondary text-sm">{(e?.hasPin || u?.hasPin) ? td("pinReset") : td("pinSet")}</button>
          </form>
        </div>
      </section>

      <section className="card space-y-3 border-danger/40">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-danger"><Icon icon={Trash2} /> {t("delete")}</h2>
        <p className="muted">{manual ? t("deleteHelp") : t("deleteSynced")}</p>
        {manual && !isSelf ? (
          <form action={deletePersonAction}>
            {hidden}
            <ConfirmSubmit message={t("deleteConfirm", { name })} className="btn-danger" data-testid="delete-person">{t("deleteButton")}</ConfirmSubmit>
          </form>
        ) : null}
      </section>
    </div>
  );
}
