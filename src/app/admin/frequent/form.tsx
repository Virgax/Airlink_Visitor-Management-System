import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { FrequentVisitor, Pass } from "@prisma/client";
import { db } from "@/lib/db";
import type { Tenant } from "@/lib/auth/guards";
import { mediaConfigured } from "@/lib/media/putFile";
import { parseSchedule } from "@/lib/passes/validate";
import { frequentNeedsNda } from "@/lib/server/frequent";
import { toLocalInput } from "@/lib/time/tz";
import { saveFrequentAction } from "./actions";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const FREQUENT_ERRORS = ["invalid", "pin", "nda", "missing_doc", "missing_plate", "gate_not_allowed", "schedule", "window_order", "window_too_long", "window_past", "host", "site", "photoType", "photoSize", "company_blocked", "forbidden", "notFound"];

type Existing = FrequentVisitor & { company: { name: string } | null; pass: Pass | null };

/** Create / edit form for a frequent visitor (server component; plain form posting to the server action). */
export async function FrequentForm({ tenant, site, existing, error }: { tenant: Tenant; site: { id: string; name: string; timezone: string }; existing: Existing | null; error: string | null }) {
  const t = await getTranslations("people.frequent");
  const tk = await getTranslations("passes");
  const [areas, employees, needsNda] = await Promise.all([
    db.area.findMany({ where: { siteId: site.id, active: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { active: true, OR: [{ siteId: site.id }, { siteId: null }] }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, department: true } }),
    frequentNeedsNda(site.id),
  ]);
  const ndaDone = Boolean(existing?.pass?.ndaAcceptedAt);
  const pass = existing?.pass ?? null;
  const schedule = parseSchedule(pass?.schedule) ?? { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00" };
  const now = new Date();
  const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const defaultFrom = toLocalInput(pass && pass.validFrom < now ? pass.validFrom : start, site.timezone);
  const defaultUntil = toLocalInput(pass && pass.validUntil > now ? pass.validUntil : new Date(start.getTime() + 180 * 86_400_000), site.timezone);
  const selfHost = employees.find((e) => e.id === tenant.user.employeeId);
  const photos = mediaConfigured();

  return (
    <form action={saveFrequentAction} className="space-y-6" encType="multipart/form-data">
      <input type="hidden" name="siteId" value={site.id} />
      {existing ? <input type="hidden" name="id" value={existing.id} /> : null}
      {error ? <p className="alert-error" role="alert">{t(`errors.${error as "invalid"}`)}</p> : null}

      <div className="card grid gap-4 sm:grid-cols-2">
        <p className="muted sm:col-span-2">{t("form.site")}: <span className="font-medium text-text">{site.name}</span></p>
        <div>
          <label className="label" htmlFor="name">{t("form.name")}</label>
          <input id="name" name="name" required minLength={2} maxLength={120} className="input" defaultValue={existing?.name ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="company">{t("form.company")}</label>
          <input id="company" name="company" maxLength={120} className="input" defaultValue={existing?.company?.name ?? ""} />
          <p className="muted mt-1">{t("form.companyHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="doc">{t("form.doc")}</label>
          <input id="doc" name="doc" maxLength={40} className="input" autoComplete="off" />
          <p className="muted mt-1">{existing?.docLast4 ? t("form.docKeep", { last4: existing.docLast4 }) : t("form.docHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="phone">{t("form.phone")}</label>
          <input id="phone" name="phone" type="tel" maxLength={40} className="input" defaultValue={existing?.phone ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="photo">{t("form.photo")}</label>
          <input id="photo" name="photo" type="file" accept="image/png,image/jpeg" className="input" disabled={!photos} />
          <p className="muted mt-1">{photos ? t("form.photoHelp") : t("form.photoUnavailable")}</p>
        </div>
        <div>
          <label className="label" htmlFor="hostEmployeeId">{t("form.host")}</label>
          <select id="hostEmployeeId" name="hostEmployeeId" className="input" required defaultValue={pass?.hostEmployeeId ?? selfHost?.id ?? ""}>
            <option value="">—</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.department ? ` · ${e.department}` : ""}</option>)}
          </select>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("form.signIn")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="signIn" value="qr_card" defaultChecked={(existing?.signIn ?? "qr_card") === "qr_card"} /> {t("signIn.qr_card")}</label>
            <label className="flex items-center gap-2"><input type="radio" name="signIn" value="pin" defaultChecked={existing?.signIn === "pin"} /> {t("signIn.pin")}</label>
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="pin">{t("form.pin")}</label>
          <input id="pin" name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="input font-mono tracking-widest" autoComplete="off" />
          <p className="muted mt-1">{t("form.pinHelp")}</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="note">{t("form.note")}</label>
          <textarea id="note" name="note" maxLength={500} rows={2} className="input" defaultValue={pass?.note ?? ""} />
        </div>
        {needsNda ? (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="ndaAccepted" required={!ndaDone} defaultChecked={ndaDone} className="mt-1" data-testid="frequent-nda" />
              <span>{t("form.nda")}<span className="muted block">{t("form.ndaHelp")}</span></span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("form.days")}</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {WEEK.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" name="days" value={d} defaultChecked={schedule.days.includes(d)} /> {tk(`weekdays.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="scheduleFrom">{t("form.from")}</label>
          <input id="scheduleFrom" name="scheduleFrom" type="time" required className="input" defaultValue={schedule.from} />
        </div>
        <div>
          <label className="label" htmlFor="scheduleTo">{t("form.to")}</label>
          <input id="scheduleTo" name="scheduleTo" type="time" required className="input" defaultValue={schedule.to} />
        </div>
        <div>
          <label className="label" htmlFor="validFrom">{t("form.validFrom")}</label>
          <input id="validFrom" name="validFrom" type="datetime-local" required className="input" defaultValue={defaultFrom} />
        </div>
        <div>
          <label className="label" htmlFor="validUntil">{t("form.validUntil")}</label>
          <input id="validUntil" name="validUntil" type="datetime-local" required className="input" defaultValue={defaultUntil} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">{t("form.areas")}</legend>
          <ul className="flex flex-wrap gap-3 text-sm">
            {areas.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2"><input type="checkbox" name="areaIds" value={a.id} defaultChecked={pass?.areaIds.includes(a.id) ?? false} /> {a.name}</label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">{existing ? t("form.update") : t("form.submit")}</button>
        <Link href="/admin/frequent" className="btn-secondary">{t("form.cancel")}</Link>
      </div>
    </form>
  );
}
