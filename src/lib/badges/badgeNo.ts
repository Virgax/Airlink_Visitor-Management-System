/**
 * Badge numbers: `<gate code>-<NNNN>`, e.g. `A2R-0042`. The sequence restarts every local day per site
 * (src/lib/server/badges.ts assigns it atomically); these helpers are pure.
 */

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Two-character site code from the slug: first letter plus the last digit of the slug when it has one
 * (`airlink-2` → `A2`), otherwise the first two letters (`santiago` → `SA`).
 */
export function siteCode(slug: string): string {
  const clean = stripAccents(slug).replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!clean) return "XX";
  const digits = clean.match(/\d/g);
  const first = clean[0]!;
  if (digits?.length) return `${first}${digits[digits.length - 1]}`;
  return (clean + "X").slice(0, 2);
}

/** Initial of the gate name without accents (`Recepción` → `R`, `Muelle` → `M`). */
export function gateInitial(name: string): string {
  const clean = stripAccents(name).replace(/[^a-z0-9]/gi, "").toUpperCase();
  return clean[0] ?? "G";
}

export function gateCode(siteSlug: string, gateName: string): string {
  return `${siteCode(siteSlug)}${gateInitial(gateName)}`;
}

export function formatBadgeNo(code: string, seq: number): string {
  return `${code}-${String(seq).padStart(4, "0")}`;
}

/** Sequence part of a badge number (`A2R-0042` → 42), or null. */
export function badgeSeq(badgeNo: string | null | undefined): number | null {
  const m = /-(\d+)$/.exec(badgeNo ?? "");
  return m ? Number(m[1]) : null;
}
