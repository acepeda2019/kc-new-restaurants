import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EvalCase, Trace } from "@/evals/graders";
import { answerForReview, parseScoreSheet, scoreSheet } from "@/evals/judge/sheet";
import { loadData } from "@/lib/data";

const data = loadData(path.join(__dirname, "..", "evals", "snapshot"));
const open = data.openings.find((o) => o.latitude !== null && o.likely_cuisine)!;
const soon = data.openingSoon[0];

const c: EvalCase = { id: "near", question: "Anything new near me?", here: { lat: open.latitude!, lon: open.longitude! }, expect: {} };
const trace: Trace = {
  searches: [],
  summary: "Two new spots near you.",
  rawPicks: [
    { id: open.restaurant_id, blurb: "Took over the old diner." },
    { id: soon.notice_id, blurb: "Applied for a licence." },
    { id: "MADE-UP", blurb: "Not a real place." },
  ],
};

describe("answerForReview", () => {
  it("shows each pick with the card the app would show, distance included", () => {
    const a = answerForReview(c, trace, data);
    expect(a.picks[0]).toMatchObject({ name: open.name, blurb: "Took over the old diner." });
    expect(a.picks[0].facts).toContain(`likely ${open.likely_cuisine}`);
    expect(a.picks[0].facts.some((f) => f.endsWith(" mi"))).toBe(true);
    expect(a.picks[1]).toMatchObject({ name: soon.trade_name });
    expect(a.picks[1].facts[0]).toMatch(/^licence applied /);
    expect(a.picks[2].name).toMatch(/unknown id/);
  });
});

describe("scoreSheet and parseScoreSheet", () => {
  const sheet = scoreSheet(
    [answerForReview(c, trace, data), { case: "none", question: "Sushi on Mars?", summary: "Nothing fits.", picks: [] }],
    "runs/x.jsonl",
  );

  it("offers three boxes for an answer with picks, one for an answer without", () => {
    expect(sheet.match(/^- \[ \]/gm)).toHaveLength(4);
    expect(sheet).toContain("> Took over the old diner.");
  });

  it("reads ticks, empty boxes and notes back; items not offered are null", () => {
    const filled = sheet
      .replace("- [ ] answers", "- [x] answers")
      .replace("- [ ] no_repeats", "- [X] no_repeats")
      .replace(/^Note:/m, "Note: second pick is vague");
    const scores = parseScoreSheet(filled);
    expect(scores.get("near")).toEqual({ scores: { answers: true, adds: false, no_repeats: true }, note: "second pick is vague" });
    expect(scores.get("none")).toEqual({ scores: { answers: false, adds: null, no_repeats: null }, note: "" });
  });
});
