import { createHmac } from "node:crypto";

/**
 * Identity documents (cédula, pasaporte) are never stored in full.
 * We keep an HMAC (to match against the blacklist) and the last 4 digits (to show).
 */
export function normalizeDoc(doc: string): string {
  return doc.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

export function docHash(doc: string, key: string): string {
  const normalized = normalizeDoc(doc);
  return createHmac("sha256", key).update(normalized).digest("hex");
}

export function docLast4(doc: string): string {
  const normalized = normalizeDoc(doc);
  return normalized.slice(-4);
}

export function normalizePlate(plate: string): string {
  return plate.replace(/[^0-9a-z]/gi, "").toUpperCase();
}
