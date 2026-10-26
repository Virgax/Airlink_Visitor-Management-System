import nodemailer, { type Transporter } from "nodemailer";
import { log } from "@/lib/log";
import { isFakeMode, recordFake } from "@/lib/notifications/fake";
import { errorMessage, type Channel, type ChannelMessage, type ChannelResult } from "./types";

export type EmailTarget = { to: string; name?: string | null; labels: { open: string; footer: string } };

type SmtpConfig = { host: string; port: number; user?: string; pass?: string; from: string };

function smtp(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return { host, port: Number.isFinite(port) ? port : 587, user: process.env.SMTP_USER || undefined, pass: process.env.SMTP_PASS || undefined, from };
}

let transporter: Transporter | null = null;

function transport(cfg: SmtpConfig): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function emailHtml(message: ChannelMessage, target: EmailTarget): string {
  return [
    `<!doctype html><html lang="${message.locale}"><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;background:#f7f7f7;padding:24px">`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dcdcdc;border-radius:12px;padding:24px">`,
    `<p style="margin:0 0 12px;font-weight:700;color:#111">Airlink <span style="color:#d7191c">Visitas</span></p>`,
    `<h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(message.title)}</h1>`,
    `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(message.body)}</p>`,
    `<p style="margin:0 0 20px"><a href="${escapeHtml(message.url)}" style="display:inline-block;background:#d7191c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(target.labels.open)}</a></p>`,
    `<p style="margin:0;font-size:12px;color:#5f5f5f">${escapeHtml(target.labels.footer)}</p>`,
    `</div></body></html>`,
  ].join("");
}

/** SMTP through nodemailer (SMTP_HOST/PORT/USER/PASS/FROM). Used for reports and as the push fallback. */
export const emailChannel: Channel<EmailTarget> = {
  name: "email",
  configured: () => isFakeMode() || smtp() !== null,
  async send(message, target): Promise<ChannelResult> {
    if (isFakeMode()) {
      recordFake({ channel: "email", to: target.to, type: message.type, title: message.title, body: message.body, url: message.url });
      return { ok: true };
    }
    const cfg = smtp();
    if (!cfg) return { ok: false, error: "smtp_not_configured" };
    try {
      await transport(cfg).sendMail({
        from: cfg.from,
        to: target.name ? { name: target.name, address: target.to } : target.to,
        subject: message.title,
        text: `${message.body}\n\n${message.url}\n\n${target.labels.footer}`,
        html: emailHtml(message, target),
      });
      return { ok: true };
    } catch (err) {
      log.warn("email.failed", { to: target.to, type: message.type, err: errorMessage(err) });
      return { ok: false, error: errorMessage(err) };
    }
  },
};
