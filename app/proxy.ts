// Passcode gate (Next.js 16 "proxy", formerly middleware): every request without a valid
// session goes to /login. Fails closed: with no SESSION_SECRET, no session is valid.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, process.env.SESSION_SECRET ?? "")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Static assets skip the gate; everything else, including other API paths, is checked.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
