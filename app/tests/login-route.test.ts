import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/login/route";

function login(body: string, cookie?: string) {
  return POST(
    new NextRequest("http://localhost/api/login", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    }),
  );
}

const json = (passcode: unknown) => JSON.stringify({ passcode });

beforeEach(() => {
  vi.stubEnv("APP_PASSCODE", "right-passcode");
  vi.stubEnv("SESSION_SECRET", "test-secret-not-real");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/login", () => {
  it.each(["APP_PASSCODE", "SESSION_SECRET"])("fails closed with 500 when %s is unset", async (name) => {
    vi.stubEnv(name, undefined);
    const res = await login(json("right-passcode"));
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["wrong", json("wrong-passcode")],
    ["non-string", json(12345)],
    ["201-char", json("a".repeat(201))],
    ["non-JSON", "not json"],
  ])("rejects a %s passcode with 401 and no cookie", async (_label, body) => {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets both cookies on the right passcode", async () => {
    const res = await login(json("right-passcode"));
    expect(res.status).toBe(200);
    const session = res.cookies.get("kcne_session");
    const visitor = res.cookies.get("kcne_visitor");
    for (const c of [session, visitor]) {
      expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    }
    expect(session?.maxAge).toBe(2592000);
    expect(visitor?.value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not overwrite an existing kcne_visitor cookie", async () => {
    const res = await login(json("right-passcode"), "kcne_visitor=existing-id");
    expect(res.status).toBe(200);
    expect(res.cookies.get("kcne_session")).toBeDefined();
    expect(res.cookies.get("kcne_visitor")).toBeUndefined();
  });
});
