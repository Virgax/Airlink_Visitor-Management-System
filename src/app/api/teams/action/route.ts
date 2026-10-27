import type { NextRequest } from "next/server";
import { createTranslator } from "next-intl";
import es from "../../../../../messages/es.json";
import en from "../../../../../messages/en.json";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { verifyTeamsAction, type TeamsAction } from "@/lib/notifications/teamsAction";
import { decideVisit } from "@/lib/server/visits";
import { decidePassFromTeams } from "@/lib/server/pass-decision";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Target of the Approve/Deny buttons on Teams cards. The signed token (`TEAMS_ACTION_SECRET`) is the only
 * credential, so GET only shows a confirmation page and POST applies the decision: link previews and
 * safe-link scanners never decide anything.
 */

const MESSAGES = { es, en } as const;

function pickLocale(request: NextRequest): "es" | "en" {
  const al = request.headers.get("accept-language") ?? "";
  return /^en\b/i.test(al.trim()) ? "en" : "es";
}

function t(locale: "es" | "en") {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "notifications.teams" });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(locale: string, title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Airlink Visitas</title>
<style>body{margin:0;background:#f7f7f7;color:#111;font-family:system-ui,"Segoe UI",Roboto,Arial,sans-serif}main{max-width:480px;margin:48px auto;padding:24px;background:#fff;border:1px solid #dcdcdc;border-radius:12px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 12px}.brand{font-weight:700;margin-bottom:16px}.brand span{color:#d7191c}button,a.btn{display:inline-block;background:#d7191c;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:16px;text-decoration:none;cursor:pointer}a.link{color:#5f5f5f;font-size:14px}</style></head>
<body><main><div class="brand">Airlink <span>Visitas</span></div>${inner}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function subjectName(action: TeamsAction): Promise<{ name: string; pending: boolean } | null> {
  if (action.kind === "visit") {
    const v = await db.visit.findUnique({ where: { id: action.id }, select: { visitorName: true, status: true } });
    return v ? { name: v.visitorName, pending: v.status === "pending" } : null;
  }
  const p = await db.pass.findUnique({ where: { id: action.id }, select: { visitorName: true, status: true } });
  return p ? { name: p.visitorName, pending: p.status === "pending_approval" } : null;
}

async function tokenFrom(request: NextRequest): Promise<string | null> {
  const fromQuery = request.nextUrl.searchParams.get("token");
  if (request.method === "GET") return fromQuery;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as { token?: unknown };
      if (typeof body?.token === "string") return body.token;
    } else if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await request.formData();
      const v = form.get("token");
      if (typeof v === "string") return v;
    }
  } catch {
    /* fall through to the query string */
  }
  return fromQuery;
}

function verify(token: string | null): TeamsAction | null {
  const secret = process.env.TEAMS_ACTION_SECRET;
  if (!secret) return null;
  return verifyTeamsAction(token, secret);
}

/** Confirmation page (no side effects). */
export async function GET(request: NextRequest) {
  const locale = pickLocale(request);
  const tr = t(locale);
  const token = await tokenFrom(request);
  const action = verify(token);
  if (!action || !token) return page(locale, tr("invalid"), `<h1>${escapeHtml(tr("invalid"))}</h1>`, 400);
  const subject = await subjectName(action);
  if (!subject || !subject.pending) return page(locale, tr("gone"), `<h1>${escapeHtml(tr("gone"))}</h1>`, 410);
  const title = action.kind === "visit" ? tr("confirmVisit", { decision: action.decision, name: subject.name }) : tr("confirmPass", { decision: action.decision, name: subject.name });
  return page(
    locale,
    title,
    `<h1>${escapeHtml(title)}</h1><form method="post" action="/api/teams/action"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">${escapeHtml(tr("confirm"))}</button></form>`,
  );
}

/** Applies the decision carried by a valid, unexpired token. */
export async function POST(request: NextRequest) {
  const locale = pickLocale(request);
  const tr = t(locale);
  const ip = clientIp(request.headers) ?? "unknown";
  const limit = await rateLimit(`teams:action:${ip}`, 60, 60);
  if (!limit.ok) return page(locale, tr("rateLimited"), `<h1>${escapeHtml(tr("rateLimited"))}</h1>`, 429);
  const action = verify(await tokenFrom(request));
  if (!action) return page(locale, tr("invalid"), `<h1>${escapeHtml(tr("invalid"))}</h1>`, 400);

  const result = action.kind === "visit" ? await decideVisit(action.id, action.decision, null, { via: "teams" }) : await decidePassFromTeams(action.id, action.decision, null);
  log.info("teams.action", { kind: action.kind, id: action.id, decision: action.decision, applied: result !== null, ip });
  if (!result) return page(locale, tr("gone"), `<h1>${escapeHtml(tr("gone"))}</h1>`, 410);
  const done = tr("done", { decision: action.decision });
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return page(locale, done, `<h1>${escapeHtml(done)}</h1>${appUrl ? `<p><a class="btn" href="${escapeHtml(appUrl)}/app/notifications">${escapeHtml(tr("openApp"))}</a></p>` : ""}`);
}
