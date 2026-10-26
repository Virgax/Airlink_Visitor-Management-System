import { NextResponse, type NextRequest } from "next/server";
import { startEntraLogin } from "@/lib/auth/entra";
import { entraConfigured } from "@/lib/env";
import { log } from "@/lib/log";

export async function GET(request: NextRequest) {
  if (!entraConfigured()) return NextResponse.redirect(new URL("/login", request.url));
  const next = request.nextUrl.searchParams.get("next");
  try {
    const url = await startEntraLogin(next && next.startsWith("/") && !next.startsWith("//") ? next : undefined);
    return NextResponse.redirect(url);
  } catch (err) {
    log.error("entra.start_failed", { err: String(err) });
    return NextResponse.redirect(new URL("/login?error=entra", request.url));
  }
}
