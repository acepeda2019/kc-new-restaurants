import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { agreement, judgeAnswer, judgeRequest } from "@/evals/judge/judge";
import type { AnswerForReview, Scores } from "@/evals/judge/sheet";
import type { AskClient } from "@/lib/ask";

const withPicks: AnswerForReview = {
  case: "kirkland",
  question: "New in Kirkland?",
  summary: "Three new places in Kirkland since Nov 1.",
  picks: [{ id: "A", name: "Lunchbox", where: "1 Main St, Kirkland", facts: ["Satisfactory · 0 pts · Nov 9"], blurb: "Passed its first inspection cleanly." }],
};
const noPicks: AnswerForReview = { case: "hours", question: "Hours?", summary: "I don't have hours.", picks: [] };

/** A client that returns `reply` as Claude's text and records the request. */
function fakeClient(reply: object, model = "claude-haiku-5-5") {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AskClient = {
    messages: {
      async create(params) {
        sent.push(params);
        return {
          model,
          content: [{ type: "text", text: JSON.stringify(reply) }],
          usage: { input_tokens: 900, output_tokens: 80 },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, sent };
}

const verdict = (answers: boolean, adds: boolean, noRepeats: boolean) => ({
  answers: { ok: answers, reason: "r1" }, adds: { ok: adds, reason: "r2" }, no_repeats: { ok: noRepeats, reason: "r3" },
});

describe("judgeRequest", () => {
  it("sends the answer as the owner saw it, with the rubric, as structured output", () => {
    const req = judgeRequest(withPicks);
    expect(req.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(req.messages)).toContain("> Passed its first inspection cleanly.");
    expect(req.system).toContain("no_repeats:");
    expect(req.output_config?.format).toMatchObject({ type: "json_schema" });
  });
});

describe("judgeAnswer", () => {
  it("returns the judge's scores, reasons and tokens", async () => {
    const { client } = fakeClient(verdict(true, true, false));
    expect(await judgeAnswer(client, withPicks)).toEqual({
      scores: { answers: true, adds: true, no_repeats: false },
      reasons: { answers: "r1", adds: "r2", no_repeats: "r3" },
      input: 900,
      output: 80,
    });
  });

  it("leaves the blurb items null for an answer with no picks, as the sheet does", async () => {
    const { client } = fakeClient(verdict(true, false, false));
    expect((await judgeAnswer(client, noPicks)).scores).toEqual({ answers: true, adds: null, no_repeats: null });
  });

  it("refuses a reply from a model other than the one asked for", async () => {
    const { client } = fakeClient(verdict(true, true, true), "claude-opus-5-5");
    await expect(judgeAnswer(client, withPicks)).rejects.toThrow(/asked for claude-haiku-5-5/);
  });
});

describe("agreement", () => {
  const s = (answers: boolean | null, adds: boolean | null, noRepeats: boolean | null): Scores => ({ answers, adds, no_repeats: noRepeats });

  it("counts matches per item over answers both scored, with the owner's yes-rate", () => {
    const owner = new Map([["a", s(true, true, false)], ["b", s(true, false, false)], ["c", s(false, null, null)], ["d", s(true, true, true)], ["e", s(true, true, true)]]);
    const judge = new Map([["a", s(true, true, true)], ["b", s(true, false, false)], ["c", s(false, null, null)], ["d", s(true, true, true)], ["e", s(true, true, true)]]);
    expect(agreement(owner, judge)).toEqual([
      { key: "answers", agree: 5, n: 5, ownerYes: 4, trusted: true },
      { key: "adds", agree: 4, n: 4, ownerYes: 3, trusted: true },
      { key: "no_repeats", agree: 3, n: 4, ownerYes: 2, trusted: false },
    ]);
  });

  it("skips answers the judge didn't score, and trusts nothing with no answers", () => {
    expect(agreement(new Map([["a", s(true, true, true)]]), new Map())[0]).toEqual({ key: "answers", agree: 0, n: 0, ownerYes: 0, trusted: false });
  });
});
