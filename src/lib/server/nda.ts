import "server-only";
import { db } from "@/lib/db";

/** Active NDA for a site: the site-specific one if any, else the global one; latest activeFrom wins. */
export async function activeNda(siteId: string, now = new Date()) {
  const rows = await db.ndaVersion.findMany({ where: { OR: [{ siteId }, { siteId: null }], activeFrom: { lte: now } }, orderBy: { activeFrom: "desc" } });
  return rows.find((n) => n.siteId === siteId) ?? rows[0] ?? null;
}

export async function currentNdaId(siteId: string): Promise<string | null> {
  return (await activeNda(siteId))?.id ?? null;
}

/** Title and body in the reader's language (English only when the version has it). */
export function ndaText(nda: { title: string; body: string; titleEn: string | null; bodyEn: string | null }, locale: string): { title: string; body: string } {
  if (locale === "en" && nda.bodyEn) return { title: nda.titleEn || nda.title, body: nda.bodyEn };
  return { title: nda.title, body: nda.body };
}
