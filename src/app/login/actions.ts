"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { clientIp, createSession } from "@/lib/auth/session";
import { listPanels } from "@/lib/auth/guards";
import { rateLimit, resetRateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { env, isProd } from "@/lib/env";
import { signValue, verifyValue } from "@/lib/crypto/tokens";

const PENDING_COOKIE = "visitas_pending";
const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

function safeNext(next: string | undefined | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

async function finish(userId: string, next: string | null): Promise<never> {
  await createSession(userId);
  await audit({ action: "auth.login", actorId: userId });
  if (next) redirect(next);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, locale: true, status: true, employeeId: true } });
  const panels = await listPanels({ ...user, guardDeviceId: null });
  redirect(panels.length === 1 && panels[0] ? panels[0].href : "/select-panel");
}

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=invalid");
  const { email, password } = parsed.data;
  const next = safeNext(parsed.data.next);
  const ip = clientIp(await headers()) ?? "unknown";

  const [byIp, byEmail] = await Promise.all([rateLimit(`login:ip:${ip}`, 60, 600), rateLimit(`login:email:${email}`, 8, 600)]);
  if (!byIp.ok || !byEmail.ok) redirect("/login?error=rateLimited");

  const user = await db.user.findUnique({ where: { email } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, null);
  if (!user || !ok) {
    await audit({ action: "auth.login_failed", meta: { email } });
    redirect("/login?error=invalid");
  }
  if (user.status !== "active") redirect("/login?error=disabled");
  await resetRateLimit(`login:email:${email}`);

  if (user.totpSecret) {
    const jar = await cookies();
    jar.set(PENDING_COOKIE, signValue(JSON.stringify({ userId: user.id, next }), env().SESSION_SECRET, 300), {
      httpOnly: true,
      secure: isProd(),
      sameSite: "lax",
      path: "/login",
      maxAge: 300,
    });
    redirect("/login?step=totp");
  }
  await finish(user.id, next);
}

const totpSchema = z.object({ code: z.string().trim().min(6).max(7) });

export async function totpAction(formData: FormData): Promise<void> {
  const parsed = totpSchema.safeParse(Object.fromEntries(formData));
  const jar = await cookies();
  const pending = verifyValue(jar.get(PENDING_COOKIE)?.value, env().SESSION_SECRET);
  if (!pending) redirect("/login?error=invalid");
  const { userId, next } = JSON.parse(pending) as { userId: string; next: string | null };
  if (!parsed.success) redirect("/login?step=totp&error=totp");

  const limit = await rateLimit(`totp:user:${userId}`, 6, 300);
  if (!limit.ok) redirect("/login?error=rateLimited");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecret || !verifyTotp(user.totpSecret, parsed.data.code)) {
    redirect("/login?step=totp&error=totp");
  }
  jar.delete(PENDING_COOKIE);
  await finish(user.id, next);
}
