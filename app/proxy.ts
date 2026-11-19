// Passcode gate (Next.js 16 "proxy", formerly middleware): every request without a valid
// session goes to /login. Fails closed: with no SESSION_SECRET, no session is valid.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// The link preview image and icons (SAN-54) are public so link previews can fetch them; they
// carry the brand only, never restaurant data.
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/opengraph-image", "/icon.svg", "/apple-icon"]);

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, process.env.SESSION_SECRET ?? "")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Only real static paths skip the gate; everything else, including other API paths, is
  // checked. Caution: /_next/image serves anything in public/ without the gate, so never
  // put private data in public/.
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"],
};
