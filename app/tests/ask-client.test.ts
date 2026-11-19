import { describe, expect, it, vi } from "vitest";
import { ASK_CHIPS, MAX_QUESTION_CHARS, askQuestion } from "@/lib/askClient";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("askQuestion", () => {
  it("posts the question, location and tried ids, and returns the answer and questions left", async () => {
    const pick = { id: "C1", kind: "open", name: "KOSHARI", city: "SEATTLE", blurb: "Clean." };
    const fetchFn = fakeFetch(200, { answer: "Try KOSHARI.", picks: [pick], left: 12 });
    const result = await askQuestion(
      { question: "  newest near me  ", here: { lat: 47.6, lon: -122.3 }, tried: new Set(["a", "b"]) },
      fetchFn,
    );
    expect(result).toEqual({ ok: true, answer: "Try KOSHARI.", picks: [pick], left: 12 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ask");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      question: "newest near me",
      here: { lat: 47.6, lon: -122.3 },
      tried: ["a", "b"],
    });
  });

  it("leaves out the location when there is none", async () => {
    const fetchFn = fakeFetch(200, { answer: "ok", left: 3 });
    await askQuestion({ question: "hi", tried: new Set() }, fetchFn);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ question: "hi", tried: [] });
  });

  it("refuses an empty or too-long question without calling the server", async () => {
    const fetchFn = fakeFetch(200, {});
    expect(await askQuestion({ question: "   ", tried: new Set() }, fetchFn)).toEqual({
      ok: false,
      message: "Type a question first.",
    });
    const long = "x".repeat(MAX_QUESTION_CHARS + 1);
    expect(await askQuestion({ question: long, tried: new Set() }, fetchFn)).toEqual({
      ok: false,
      message: `Keep it under ${MAX_QUESTION_CHARS} characters.`,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("passes on the server's message for a refusal, and marks a cap hit", async () => {
    const msg = "Out of questions for today. The map and lists still work.";
    expect(await askQuestion({ question: "hi", tried: new Set() }, fakeFetch(429, { message: msg }))).toEqual({
      ok: false,
      message: msg,
      outOfQuestions: true,
    });
    expect(await askQuestion({ question: "hi", tried: new Set() }, fakeFetch(503, { message: "Try later." }))).toEqual({
      ok: false,
      message: "Try later.",
    });
  });

  it("gives a plain message when the network fails or the reply isn't JSON", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const garbled = vi.fn(async () => new Response("<html>", { status: 502 }));
    const expected = { ok: false, message: "Couldn't reach the server. Try again." };
    expect(await askQuestion({ question: "hi", tried: new Set() }, down)).toEqual(expected);
    expect(await askQuestion({ question: "hi", tried: new Set() }, garbled)).toEqual(expected);
  });
});

describe("ASK_CHIPS", () => {
  it("are short example questions within the length limit", () => {
    expect(ASK_CHIPS.length).toBeGreaterThanOrEqual(3);
    for (const chip of ASK_CHIPS) expect(chip.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
  });
});
