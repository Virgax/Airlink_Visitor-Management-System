import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

export const db = new PrismaClient();

/** Creates a local user with a password and a host membership (every site). Returns credentials. */
export async function createLocalHost(stamp: string | number) {
  const email = `host-${stamp}@airlink.test`;
  const password = `Host-${stamp}-pass!`;
  await db.user.create({
    data: { email, name: `Host ${stamp}`, passwordHash: await hashPassword(password), memberships: { create: { role: "host", siteId: null } } },
  });
  return { email, password };
}
