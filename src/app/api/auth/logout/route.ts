import { NextResponse, type NextRequest } from "next/server";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (user) await audit({ action: "auth.logout", actorId: user.id });
  await destroySession();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
