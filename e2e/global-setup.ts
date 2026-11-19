import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * The seeded sites get the production defaults (photos and devices required of every visitor). Most specs create
 * bare passes and scan them, so the test sites start with those two rules off; specs that cover the rules turn
 * them on explicitly and restore them.
 */
export default async function globalSetup(): Promise<void> {
  const db = new PrismaClient();
  try {
    for (const site of await db.site.findMany({ where: { slug: { in: ["airlink-2", "airlink-3"] } } })) {
      const current = site.settings && typeof site.settings === "object" && !Array.isArray(site.settings) ? (site.settings as Record<string, unknown>) : {};
      await db.site.update({ where: { id: site.id }, data: { settings: { ...current, requirePhotos: false, requireDevices: false } } });
    }
  } finally {
    await db.$disconnect();
  }
}
