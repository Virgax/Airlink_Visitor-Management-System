import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

// /guard is not listed: the kiosk enrolls with a device cookie and signs in with a PIN on the page itself.
const PROTECTED_PREFIXES = ["/admin", "/app", "/select-panel", "/account"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Canonical host redirect (www → apex, etc.)
  const canonical = process.env.CANONICAL_HOST;
  const host = request.headers.get("host");
  if (canonical && host && host !== canonical && !host.startsWith("localhost")) {
    const url = request.nextUrl.clone();
    url.host = canonical;
    return NextResponse.redirect(url, 308);
  }

  // Cheap cookie presence check; real session validation happens in requireUser/requireMembership.
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (!request.cookies.get(SESSION_COOKIE)?.value) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== "production" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
