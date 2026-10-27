/**
 * Provisional (offline) check of a scanned payload against the cached list of today's passes.
 * No signature verification happens here: the kiosk never holds the signing key. The server re-validates
 * every queued scan and records `conflict` when a pass was consumed meanwhile.
 */
import { parsePayloadShape } from "@/lib/guard/payload";

export type CachedPass = {
  id: string;
  visitorName: string;
  company: string | null;
  host: string | null;
  kind: string;
  /** ISO strings so the object survives IndexedDB/JSON round trips unchanged. */
  validFrom: string;
  validUntil: string;
  maxUses: number;
  uses: number;
  warnings: string[];
  areas: string[];
};

export type PassCache = { generatedAt: string; passes: CachedPass[]; blacklistCount: number };

export type ProvisionalReason = "malformed" | "not_found" | "qr_expired" | "not_yet_valid" | "expired" | "no_uses_left";

export type ProvisionalResult = { ok: true; pass: CachedPass } | { ok: false; reason: ProvisionalReason; pass?: CachedPass };

export function provisionalCheck(cache: PassCache | null, payload: string, now = new Date()): ProvisionalResult {
  const shape = parsePayloadShape(payload);
  if (!shape) return { ok: false, reason: "malformed" };
  const pass = cache?.passes.find((p) => p.id === shape.passId);
  if (!pass) return { ok: false, reason: "not_found" };
  const nowSec = Math.floor(now.getTime() / 1000);
  if (shape.kind === "static" && shape.exp < nowSec) return { ok: false, reason: "qr_expired", pass };
  if (now < new Date(pass.validFrom)) return { ok: false, reason: "not_yet_valid", pass };
  if (now >= new Date(pass.validUntil)) return { ok: false, reason: "expired", pass };
  if (pass.uses >= pass.maxUses) return { ok: false, reason: "no_uses_left", pass };
  return { ok: true, pass };
}

/** A cache older than this is not trusted for provisional decisions. */
export const CACHE_MAX_AGE_MS = 6 * 3_600_000;

export function cacheIsFresh(cache: PassCache | null, now = new Date()): cache is PassCache {
  if (!cache) return false;
  const age = now.getTime() - new Date(cache.generatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= CACHE_MAX_AGE_MS;
}
