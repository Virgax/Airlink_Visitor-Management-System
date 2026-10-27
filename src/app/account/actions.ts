"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { signValue, verifyValue } from "@/lib/crypto/tokens";
import { isProd } from "@/lib/env";
import { getSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";

const TOTP_PENDING = "visitas_totp_pending";

async function me() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/account");
  return user;
}

const pwSchema = z.object({ current: z.string().max(200).optional(), password: z.string().min(PASSWORD_MIN_LENGTH).max(200), confirm: z.string().max(200) });

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await me();
  const parsed = pwSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/account?error=weak");
  if (parsed.data.password !== parsed.data.confirm) redirect("/account?error=mismatch");
  const full = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (full.passwordHash && !(await verifyPassword(parsed.data.current ?? "", full.passwordHash))) redirect("/account?error=wrong");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password) } });
  redirect("/account?ok=password");
}

export async function setPinAction(formData: FormData): Promise<void> {
  const user = await me();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!/^\d{4,8}$/.test(pin)) redirect("/account?error=pin");
  await db.user.update({ where: { id: user.id }, data: { pinHash: await hashPassword(pin) } });
  redirect("/account?ok=pin");
}

export async function totpStartAction(): Promise<void> {
  await me();
  const secret = generateTotpSecret();
  const jar = await cookies();
  jar.set(TOTP_PENDING, signValue(secret, await getSecret("SESSION_SECRET"), 600), { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/account", maxAge: 600 });
  redirect("/account?totp=setup");
}

export async function totpConfirmAction(formData: FormData): Promise<void> {
  const user = await me();
  const jar = await cookies();
  const secret = verifyValue(jar.get(TOTP_PENDING)?.value, await getSecret("SESSION_SECRET"));
  const code = String(formData.get("code") ?? "");
  if (!secret || !verifyTotp(secret, code)) redirect("/account?totp=setup&error=totp");
  await db.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
  jar.delete(TOTP_PENDING);
  await audit({ action: "auth.totp_enrolled", actorId: user.id });
  redirect("/account?ok=totp");
}

/** Only for rendering the setup screen. */
export async function pendingTotpSecret(): Promise<string | null> {
  const jar = await cookies();
  return verifyValue(jar.get(TOTP_PENDING)?.value, await getSecret("SESSION_SECRET"));
}
