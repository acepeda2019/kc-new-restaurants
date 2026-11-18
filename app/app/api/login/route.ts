import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  VISITOR_COOKIE,
  safeEqual,
  signSession,
} from "@/lib/auth";

const MAX_PASSCODE_LENGTH = 200;

export async function POST(request: NextRequest) {
  const expected = process.env.APP_PASSCODE;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret) {
    return NextResponse.json({ error: "Login is not configured." }, { status: 500 });
  }

  const body: unknown = await request.json().catch(() => null);
  const passcode =
    body && typeof body === "object" && "passcode" in body ? body.passcode : undefined;
  if (
    typeof passcode !== "string" ||
    passcode.length > MAX_PASSCODE_LENGTH ||
    !safeEqual(passcode, expected)
  ) {
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  const cookie = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
  response.cookies.set(SESSION_COOKIE, await signSession(secret), {
    ...cookie,
    maxAge: SESSION_MAX_AGE_S,
  });
  if (!request.cookies.has(VISITOR_COOKIE)) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      ...cookie,
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}
