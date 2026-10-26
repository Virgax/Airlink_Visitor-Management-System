import "server-only";
import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { env, entraConfigured, isProd } from "@/lib/env";

const STATE_COOKIE = "visitas_oidc";
const STATE_TTL_SEC = 10 * 60;

let configPromise: Promise<oidc.Configuration> | null = null;

/** Discovered Entra ID configuration (cached per process). */
export function entraConfig(): Promise<oidc.Configuration> {
  if (!entraConfigured()) throw new Error("Entra ID is not configured");
  if (!configPromise) {
    const e = env();
    const issuer = new URL(`https://login.microsoftonline.com/${e.ENTRA_TENANT_ID}/v2.0`);
    configPromise = oidc.discovery(issuer, e.ENTRA_CLIENT_ID!, e.ENTRA_CLIENT_SECRET!);
  }
  return configPromise;
}

export function entraRedirectUri(): string {
  return `${env().APP_URL}/api/auth/callback/microsoft-entra-id`;
}

/** Builds the authorization URL and stores PKCE verifier + state + nonce in a short-lived cookie. */
export async function startEntraLogin(next?: string): Promise<string> {
  const config = await entraConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: entraRedirectUri(),
    scope: "openid profile email",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });

  const jar = await cookies();
  jar.set(STATE_COOKIE, JSON.stringify({ codeVerifier, state, nonce, next: next ?? null }), {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: STATE_TTL_SEC,
  });
  return url.href;
}

export type EntraClaims = { sub: string; email: string; name: string };

/** Exchanges the callback for validated ID-token claims. Returns the `next` path stored at login. */
export async function finishEntraLogin(callbackUrl: URL): Promise<{ claims: EntraClaims; next: string | null }> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!raw) throw new Error("Missing OIDC state");
  const saved = JSON.parse(raw) as { codeVerifier: string; state: string; nonce: string; next: string | null };

  const config = await entraConfig();
  const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: saved.codeVerifier,
    expectedState: saved.state,
    expectedNonce: saved.nonce,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("No ID token claims");
  const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
  if (!email) throw new Error("Entra account has no email");
  return {
    claims: { sub: String(claims.sub), email, name: String(claims.name ?? email) },
    next: saved.next,
  };
}
