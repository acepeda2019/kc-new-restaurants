import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RateLimitError } from "@anthropic-ai/sdk";
import { signSession } from "@/lib/auth";

// No real Claude or Redis call can happen: both clients are fakes.
const fakes = vi.hoisted(() => ({ create: vi.fn(), checkAndCount: vi.fn(), clientOptions: [] as unknown[] }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/sdk")>()),
  default: class {
    messages = { create: fakes.create };
    constructor(options: unknown) {
      fakes.clientOptions.push(options);
    }
  },
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@/lib/caps", () => ({ checkAndCount: fakes.checkAndCount }));

import { POST } from "@/app/api/ask/route";
import { SAMPLE_NOTE } from "@/lib/ask";

const SECRET = "test-secret-not-real";
const OUT_OF_QUESTIONS = { message: "Out of questions for today. The map and lists still work." };
const UNAVAILABLE = { message: "Couldn't get an answer right now. Try again later." };

async function ask(body: unknown, { session = true, visitor = "visitor-1" } = {}) {
  const cookies = [
    session ? `kcne_session=${await signSession(SECRET)}` : "",
    visitor ? `kcne_visitor=${visitor}` : "",
  ].filter(Boolean);
  return POST(
    new NextRequest("http://localhost/api/ask", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: cookies.join("; ") },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
  vi.stubEnv("KV_REST_API_URL", "https://redis.invalid");
  vi.stubEnv("KV_REST_API_TOKEN", "token-not-real");
  fakes.checkAndCount.mockResolvedValue({ ok: true, left: 7 });
  fakes.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "Try KOSHARI." }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fakes.clientOptions.length = 0;
});

describe("POST /api/ask", () => {
  it("answers a valid question, calling Claude once", async () => {
    const res = await ask({ question: "Newest near me", here: { lat: 47.6, lon: -122.3 }, tried: ["X"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: `Try KOSHARI.\n\n${SAMPLE_NOTE}`, left: 7 });
    expect(fakes.create).toHaveBeenCalledOnce();
    expect(fakes.clientOptions).toEqual([{ apiKey: "sk-test-not-real", timeout: 20_000, maxRetries: 0 }]);
    expect(fakes.checkAndCount).toHaveBeenCalledWith(expect.anything(), "visitor-1", expect.any(Date));
  });

  it("returns 401 without a valid session", async () => {
    const res = await ask({ question: "hi" }, { session: false });
    expect(res.status).toBe(401);
    expect(fakes.checkAndCount).not.toHaveBeenCalled();
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a 501-char question", { question: "a".repeat(501) }],
    ["a blank question", { question: "   " }],
    ["a non-string question", { question: 5 }],
    ["non-JSON", "not json"],
    ["a non-finite location", { question: "hi", here: { lat: "47", lon: -122 } }],
    ["a non-array tried", { question: "hi", tried: "X" }],
    ["1001 tried ids", { question: "hi", tried: Array.from({ length: 1001 }, (_, i) => `id${i}`) }],
  ])("returns 400 for %s, before counting or calling Claude", async (_label, body) => {
    const res = await ask(body);
    expect(res.status).toBe(400);
    expect(fakes.checkAndCount).not.toHaveBeenCalled();
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("accepts a 500-char question", async () => {
    expect((await ask({ question: "a".repeat(500) })).status).toBe(200);
  });

  it("returns 400 without a visitor cookie", async () => {
    const res = await ask({ question: "hi" }, { visitor: "" });
    expect(res.status).toBe(400);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("returns 429 when a cap is hit", async () => {
    fakes.checkAndCount.mockResolvedValue({ ok: false, reason: "visitor" });
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(OUT_OF_QUESTIONS);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("fails closed with 429 when Redis is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakes.checkAndCount.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(OUT_OF_QUESTIONS);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it.each(["KV_REST_API_URL", "KV_REST_API_TOKEN"])("fails closed with 429 when %s is unset", async (name) => {
    vi.stubEnv(name, undefined);
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(429);
    expect(fakes.checkAndCount).not.toHaveBeenCalled();
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("returns 503 without ANTHROPIC_API_KEY, never building a client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(UNAVAILABLE);
    expect(fakes.clientOptions).toEqual([]);
    expect(fakes.checkAndCount).not.toHaveBeenCalled();
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it("returns 503 on a Claude error and logs only status and error class", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fakes.create.mockRejectedValue(new RateLimitError(429, undefined, "slow down", new Headers()));
    const res = await ask({ question: "secret question text", here: { lat: 47.6111, lon: -122.3333 } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(UNAVAILABLE);
    expect(log).toHaveBeenCalledWith("ask failed", { status: 429, error: "RateLimitError" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("secret question text");
    expect(logged).not.toContain("47.6111");
  });
});
