import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AI_BRIEF_MAX_TOKENS, buildAiBriefRequest, parseAiBrief, writeAiBrief } from "@/lib/aiBrief";
import type { AskClient } from "@/lib/ask";
import type { BriefFacts } from "@/lib/brief";

vi.mock("server-only", () => ({}));

const FACTS: BriefFacts = {
  opened_this_week: 4,
  opened_this_month: 10,
  highlights: [
    { id: "K1", name: "KOSHARI", kind: "open", city: "Seattle", food_truck: false, likely_cuisine: "Egyptian" },
  ],
  red_points_count: 2,
  food_trucks_count: 1,
  opening_soon: { id: "N1", name: "67 PIZZA", kind: "soon", city: "Kirkland", food_truck: false, likely_cuisine: null },
};

function client(reply: Partial<Anthropic.Message>): AskClient {
  return { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [], ...reply }) } };
}
const text = (t: string) => [{ type: "text" as const, text: JSON.stringify({ text: t }), citations: null }];

describe("buildAiBriefRequest", () => {
  it("is one capped Haiku call with the facts as data", () => {
    const p = buildAiBriefRequest(FACTS);
    expect(p).toMatchObject({ model: "claude-haiku-5-5", max_tokens: AI_BRIEF_MAX_TOKENS, thinking: { type: "disabled" } });
    expect(String(p.messages[0].content)).toContain('"KOSHARI"');
    expect(String(p.system)).toContain("{{id}}");
  });
});

describe("parseAiBrief", () => {
  it("turns {{id}} tokens into place references with our names", () => {
    expect(parseAiBrief("Busy week: {{K1}} is new, and {{N1}} applied to open.", FACTS)).toEqual([
      ["Busy week: ", { id: "K1", name: "KOSHARI" }, " is new, and ", { id: "N1", name: "67 PIZZA" }, " applied to open."],
    ]);
  });

  it.each([
    ["an unknown id", "Try {{X9}} today."],
    ["a broken token", "Try {{K1} today."],
    ["HTML", "Try <b>{{K1}}</b>."],
    ["empty text", "  "],
    ["text that is too long", "a".repeat(501)],
  ])("rejects %s", (_, t) => {
    expect(parseAiBrief(t, FACTS)).toBeNull();
  });
});

describe("writeAiBrief", () => {
  it("returns the parsed brief", async () => {
    expect(await writeAiBrief(client({ content: text("{{K1}} opened.") }), FACTS)).toEqual([
      [{ id: "K1", name: "KOSHARI" }, " opened."],
    ]);
  });

  it("falls back (null) on a refusal, a cut-off, bad JSON or an API error", async () => {
    expect(await writeAiBrief(client({ stop_reason: "refusal" }), FACTS)).toBeNull();
    expect(await writeAiBrief(client({ stop_reason: "max_tokens", content: text("{{K1}}") }), FACTS)).toBeNull();
    expect(await writeAiBrief(client({ content: [{ type: "text", text: "not json", citations: null }] }), FACTS)).toBeNull();
    const failing: AskClient = { messages: { create: vi.fn().mockRejectedValue(new Error("down")) } };
    expect(await writeAiBrief(failing, FACTS)).toBeNull();
  });
});
