import "server-only";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import QRCode from "qrcode";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import { db } from "@/lib/db";
import { env, isProd } from "@/lib/env";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { signValue, verifyValue } from "@/lib/crypto/tokens";
import { emailChannel } from "@/lib/notifications/channels/email";
import { absoluteUrl } from "@/lib/notifications/channels/types";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { fmtDate } from "@/lib/format";
import { parseSchedule } from "@/lib/passes/validate";
import { qrPayloadFor } from "@/lib/server/passes";
import { loadPolicy } from "@/lib/server/passes";
import { evaluatePolicy } from "@/lib/policies/evaluate";
import { buildCsv, csvDate, EXPORT_MAX_ROWS, type ReportTenant, reportTimeZone, scopeSites } from "@/lib/server/reports";
import { rangeToUtc, VISIT_KINDS, REPORT_PAGE_SIZE } from "@/lib/server/reports-filters";
import { addDaysYmd, diffDaysYmd, localParts } from "@/lib/time/tz";

/**
 * Invitations: the one-time PIN flash shown to the host after creating a pass, the "send by e-mail" invitation
 * (link + QR inline + window + instructions + NDA note) and the admin-wide invites report with its CSV.
 */

// ───────────────────────────── One-time PIN flash ─────────────────────────────

const PIN_FLASH_COOKIE = "visitas_pin";
const PIN_FLASH_TTL_SEC = 10 * 60;

/** Keeps the plain PIN for a few minutes in a signed HttpOnly cookie so the detail page can show it once. */
export async function setPinFlash(passId: string, pin: string): Promise<void> {
  const secret = await getSecret("SESSION_SECRET");
  const jar = await cookies();
  jar.set(PIN_FLASH_COOKIE, signValue(`${passId}:${pin}`, secret, PIN_FLASH_TTL_SEC), { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/app", maxAge: PIN_FLASH_TTL_SEC });
}

/** The plain PIN for this pass while the flash cookie is valid, else null. */
export async function readPinFlash(passId: string): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(PIN_FLASH_COOKIE)?.value;
  if (!raw) return null;
  const value = verifyValue(raw, await getSecret("SESSION_SECRET"));
  if (!value) return null;
  const [id, pin] = value.split(":");
  return id === passId && pin ? pin : null;
}

// ───────────────────────────── Invitation e-mail ─────────────────────────────

const MESSAGES: Record<Locale, typeof es> = { es, en };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type InviteEmailInput = {
  passId: string;
  to: string;
  /** Language of the e-mail (the visitor's, defaulting to the host's). */
  locale: string;
  /** Plain PIN when it is still known (just created); never read back from the hash. */
  pin?: string | null;
  actorId: string;
};

export type InviteEmailResult = { ok: true } | { ok: false; error: "not_found" | "not_open" | "email_not_configured" | string };

/**
 * Sends the invitation for a pass through the e-mail channel: link, QR inline (static passes; rotating passes link
 * to the page since their code changes every 30 s), validity window, arrival instructions and the NDA note.
 * Audits `pass.emailed`.
 */
export async function sendPassInviteEmail(input: InviteEmailInput): Promise<InviteEmailResult> {
  const pass = await db.pass.findUnique({
    where: { id: input.passId },
    include: { site: { select: { id: true, name: true, address: true, timezone: true, settings: true } }, host: { select: { name: true, department: true } }, company: { select: { name: true } } },
  });
  if (!pass) return { ok: false, error: "not_found" };
  if (!(pass.status === "active" || pass.status === "pending_approval") || pass.validUntil <= new Date()) return { ok: false, error: "not_open" };
  if (!emailChannel.configured()) return { ok: false, error: "email_not_configured" };

  const locale: Locale = isLocale(input.locale) ? input.locale : defaultLocale;
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "people.inviteEmail" });
  const tp = createTranslator({ locale, messages: MESSAGES[locale], namespace: "passes" });
  const url = absoluteUrl(`/v/${pass.token}`);
  const tz = pass.site.timezone;
  const policy = await loadPolicy(pass.siteId, pass.kind);
  const needsNda = evaluatePolicy(policy, { kind: pass.kind }).warnings.includes("nda") && !pass.ndaAcceptedAt;
  const schedule = parseSchedule(pass.schedule);
  const qr = pass.status === "active" ? await qrPayloadFor(pass) : null;
  const qrDataUrl = qr && !qr.rotating ? await QRCode.toDataURL(qr.payload, { margin: 1, width: 240, errorCorrectionLevel: "M" }) : null;
  const settings = (pass.site.settings ?? {}) as Record<string, unknown>;
  const instructions = typeof settings.arrivalInstructions === "string" ? settings.arrivalInstructions : "";

  const window = `${fmtDate(pass.validFrom, locale, { timeZone: tz })} → ${fmtDate(pass.validUntil, locale, { timeZone: tz })}`;
  const lines: string[] = [
    t("greeting", { name: pass.visitorName }),
    t("intro", { site: pass.site.name, host: pass.host.name }),
    `${t("window")}: ${window}`,
    ...(schedule ? [`${t("schedule")}: ${schedule.days.map((d) => tp(`weekdays.${d}` as "weekdays.0")).join(" ")} · ${schedule.from}–${schedule.to}`] : []),
    ...(pass.site.address ? [`${t("address")}: ${pass.site.address}`] : []),
    ...(input.pin ? [t("pin", { pin: input.pin })] : pass.pinHash ? [t("pinAskHost")] : []),
    t("instructions"),
    ...(instructions ? [instructions] : []),
    ...(needsNda ? [t("nda")] : []),
    ...(pass.status === "pending_approval" ? [t("pending")] : []),
    ...(pass.selfRegistration && !pass.registeredAt ? [t("register")] : []),
  ];
  const body = lines.join("\n\n");
  const title = t("subject", { site: pass.site.name });
  const footer = t("footer");
  const open = t("open");
  const html = [
    `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;background:#f7f7f7;padding:24px">`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dcdcdc;border-radius:12px;padding:24px">`,
    `<p style="margin:0 0 12px;font-weight:700;color:#111">Airlink <span style="color:#d7191c">Visitas</span></p>`,
    `<h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(title)}</h1>`,
    ...lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5;white-space:pre-wrap">${escapeHtml(l)}</p>`),
    qrDataUrl ? `<p style="margin:0 0 16px;text-align:center"><img src="${qrDataUrl}" alt="QR" width="240" height="240" style="border:1px solid #dcdcdc;border-radius:8px;background:#fff" /></p>` : qr?.rotating ? `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(t("rotating"))}</p>` : "",
    `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#d7191c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(open)}</a></p>`,
    `<p style="margin:0;font-size:12px;color:#5f5f5f">${escapeHtml(footer)}</p>`,
    `</div></body></html>`,
  ].join("");

  const res = await emailChannel.send(
    { type: "pass_approved", title, body, url, locale, siteId: pass.siteId, payload: { passId: pass.id, invite: true } },
    { to: input.to, name: pass.visitorName, labels: { open, footer }, html },
  );
  if (!res.ok) return { ok: false, error: res.error };
  if (!pass.visitorEmail) await db.pass.update({ where: { id: pass.id }, data: { visitorEmail: input.to } });
  await audit({ action: "pass.emailed", siteId: pass.siteId, actorId: input.actorId, targetType: "Pass", targetId: pass.id, meta: { to: input.to, qr: Boolean(qrDataUrl), pin: Boolean(input.pin) } });
  return { ok: true };
}

// ───────────────────────────── Invites report ─────────────────────────────

export const PASS_STATUSES = ["active", "pending_approval", "used", "revoked", "expired", "denied"] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);

const schema = z.object({
  from: z.preprocess((v) => (typeof pick(v) === "string" && YMD.test(pick(v) as string) ? pick(v) : undefined), z.string().optional()),
  to: z.preprocess((v) => (typeof pick(v) === "string" && YMD.test(pick(v) as string) ? pick(v) : undefined), z.string().optional()),
  siteId: z.preprocess((v) => (typeof pick(v) === "string" && ID.test(pick(v) as string) ? pick(v) : undefined), z.string().optional()),
  kind: z.preprocess((v) => ((VISIT_KINDS as readonly string[]).includes(pick(v) as string) ? pick(v) : undefined), z.enum(VISIT_KINDS).optional()),
  status: z.preprocess((v) => ((PASS_STATUSES as readonly string[]).includes(pick(v) as string) ? pick(v) : undefined), z.enum(PASS_STATUSES).optional()),
  pin: z.preprocess((v) => (pick(v) === "yes" || pick(v) === "no" ? pick(v) : undefined), z.enum(["yes", "no"]).optional()),
  signedIn: z.preprocess((v) => (pick(v) === "yes" || pick(v) === "no" ? pick(v) : undefined), z.enum(["yes", "no"]).optional()),
  q: z.preprocess((v) => (typeof pick(v) === "string" && (pick(v) as string).trim() ? (pick(v) as string).trim().slice(0, 80) : undefined), z.string().optional()),
  page: z.preprocess((v) => {
    const n = Number(typeof pick(v) === "string" ? pick(v) : "1");
    return Number.isInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
  }, z.number().int().min(1)),
});

export type InviteFilters = Omit<z.infer<typeof schema>, "from" | "to"> & { from: string; to: string };

/** Parses the invites report search params; dates are local days in the site's time zone (default: last 30 days). */
export function parseInviteFilters(raw: Record<string, string | string[] | undefined>, opts: { timeZone: string; now?: Date }): InviteFilters {
  const parsed = schema.parse(raw);
  const today = localParts(opts.now ?? new Date(), opts.timeZone).ymd;
  let from = parsed.from ?? (parsed.to ? addDaysYmd(parsed.to, -30) : addDaysYmd(today, -30));
  let to = parsed.to ?? (parsed.from ? addDaysYmd(parsed.from, 30) : addDaysYmd(today, 30));
  if (diffDaysYmd(from, to) < 0) [from, to] = [to, from];
  if (diffDaysYmd(from, to) > 365) to = addDaysYmd(from, 365);
  return { ...parsed, from, to };
}

const inviteInclude = {
  site: { select: { id: true, name: true, timezone: true } },
  host: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  frequentVisitor: { select: { id: true } },
  visits: { select: { id: true, enteredAt: true, status: true }, orderBy: { createdAt: "asc" as const }, take: 1 },
} satisfies Prisma.PassInclude;

export type InviteRow = Prisma.PassGetPayload<{ include: typeof inviteInclude }>;

export function inviteWhere(filters: InviteFilters, tenant: ReportTenant): Prisma.PassWhereInput {
  const range = rangeToUtc(filters, reportTimeZone(filters, tenant));
  return {
    ...scopeSites(filters, tenant),
    // An invite belongs to the day its window starts.
    validFrom: { gte: range.from, lt: range.to },
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.pin === "yes" ? { pinHash: { not: null } } : filters.pin === "no" ? { pinHash: null } : {}),
    ...(filters.signedIn === "yes" ? { visits: { some: {} } } : filters.signedIn === "no" ? { visits: { none: {} } } : {}),
    ...(filters.q
      ? {
          OR: [
            { visitorName: { contains: filters.q, mode: "insensitive" } },
            { visitorEmail: { contains: filters.q, mode: "insensitive" } },
            { host: { name: { contains: filters.q, mode: "insensitive" } } },
            { company: { name: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export async function queryInvites(filters: InviteFilters, tenant: ReportTenant, opts: { all?: boolean } = {}) {
  const where = inviteWhere(filters, tenant);
  const pageSize = opts.all ? EXPORT_MAX_ROWS : REPORT_PAGE_SIZE;
  const [total, signedIn] = await Promise.all([db.pass.count({ where }), db.pass.count({ where: { AND: [where, { visits: { some: {} } }] } })]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = opts.all ? 1 : Math.min(filters.page, pages);
  const rows = await db.pass.findMany({ where, include: inviteInclude, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize });
  return { rows, total, signedIn, page, pages, pageSize };
}

export type InviteCsvLabels = Record<"date" | "visitor" | "email" | "company" | "host" | "kind" | "site" | "pin" | "signedIn" | "enteredAt" | "status" | "validUntil" | "createdBy" | "frequent" | "yes" | "no", string> & {
  kinds: Record<string, string>;
  statuses: Record<string, string>;
};

/** Pure CSV builder for the invites report (`;` separator, BOM, CRLF like the other reports). */
export function invitesToCsv(rows: InviteRow[], timeZone: string, labels: InviteCsvLabels): string {
  const header = [labels.date, labels.visitor, labels.email, labels.company, labels.host, labels.kind, labels.site, labels.pin, labels.signedIn, labels.enteredAt, labels.status, labels.validUntil, labels.createdBy, labels.frequent];
  const yn = (b: boolean) => (b ? labels.yes : labels.no);
  const lines = rows.map((r) => [
    csvDate(r.validFrom, timeZone),
    r.visitorName,
    r.visitorEmail,
    r.company?.name,
    r.host.name,
    labels.kinds[r.kind] ?? r.kind,
    r.site.name,
    yn(Boolean(r.pinHash)),
    yn(r.visits.length > 0),
    csvDate(r.visits[0]?.enteredAt ?? null, timeZone),
    labels.statuses[r.status] ?? r.status,
    csvDate(r.validUntil, timeZone),
    r.createdBy.name,
    yn(Boolean(r.frequentVisitor)),
  ]);
  return buildCsv(header, lines);
}

export function appUrl(path: string): string {
  return `${env().APP_URL.replace(/\/$/, "")}${path}`;
}
