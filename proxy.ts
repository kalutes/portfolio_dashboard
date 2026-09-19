import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie, validSession } from "./lib/auth/session";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const publicPath =
    path === "/login" ||
    path === "/api/health" ||
    path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path === "/offline.html" ||
    path === "/favicon.ico" ||
    path.startsWith("/icons/") ||
    path.startsWith("/_next/static/");
  if (publicPath || validSession(request.cookies.get(sessionCookie)?.value))
    return NextResponse.next();
  if (path.startsWith("/api/"))
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
export const config = { matcher: "/:path*" };
