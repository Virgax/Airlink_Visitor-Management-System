import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 128-bit random token, URL-safe (used for /v/<token>, sessions, invitations). */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

import { createHmac } from "node:crypto";

/** `value.exp.sig` signed with a server secret; for short-lived state in cookies. */
export function signValue(value: string, secret: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${Buffer.from(value).toString("base64url")}.${exp}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyValue(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const [b64, expStr, sig] = signed.split(".");
  if (!b64 || !expStr || !sig) return null;
  const body = `${b64}.${expStr}`;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return Buffer.from(b64, "base64url").toString();
}
