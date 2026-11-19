import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { signSession } from "@/lib/auth";

const secret = "test-secret-not-real";

function request(path: string, token?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: token ? { cookie: `kcne_session=${token}` } : {},
  });
}

function expectRedirectToLogin(res: Response) {
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://localhost/login");
}

function expectPassThrough(res: Response) {
  expect(res.headers.get("x-middleware-next")).toBe("1");
}

beforeEach(() => vi.stubEnv("SESSION_SECRET", secret));
afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it.each(["/login", "/api/login", "/opengraph-image", "/icon.svg", "/apple-icon"])("lets %s through without a cookie", async (path) => {
    expectPassThrough(await proxy(request(path)));
  });

  it.each(["/", "/restaurant/1", "/api/ask", "/api/other"])("redirects %s without a cookie", async (path) => {
    expectRedirectToLogin(await proxy(request(path)));
  });

  it("redirects an expired token", async () => {
    const old = await signSession(secret, new Date("2020-01-01T00:00:00Z"));
    expectRedirectToLogin(await proxy(request("/", old)));
  });

  it("redirects a forged token", async () => {
    expectRedirectToLogin(await proxy(request("/", "9999999999.AAAA")));
    expectRedirectToLogin(await proxy(request("/", await signSession("other-secret"))));
  });

  it("lets a valid token through", async () => {
    expectPassThrough(await proxy(request("/", await signSession(secret))));
  });

  it("redirects even a signed token when SESSION_SECRET is unset", async () => {
    const token = await signSession(secret);
    vi.stubEnv("SESSION_SECRET", undefined);
    expectRedirectToLogin(await proxy(request("/", token)));
  });
});

describe("proxy matcher", () => {
  const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each(["/_next/static/chunks/main.js", "/_next/image", "/_next/image?url=%2Fa.png&w=64&q=75", "/favicon.ico"])(
    "skips the static path %s",
    (url) => expect(runsOn(url)).toBe(false),
  );

  it.each(["/", "/login", "/favicon.icox", "/_next/staticx", "/_next/image/x", "/_next/imagex"])(
    "gates %s",
    (url) => expect(runsOn(url)).toBe(true),
  );
});
