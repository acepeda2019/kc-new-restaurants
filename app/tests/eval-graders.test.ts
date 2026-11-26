import { describe, expect, it } from "vitest";
import { grade, numbersIn, passRates, type EvalCase, type Trace } from "@/evals/graders";

const ANY = {
  name: null, city: null, cuisine: null, category: null, first_inspected_since: null,
  latest_unsatisfactory: false, include_opening_soon: false,
};

const KIRKLAND: EvalCase = {
  id: "kirkland-month",
  question: "How many new restaurants opened in Kirkland this month?",
  expect: { filters: { city: "Kirkland", first_inspected_since: "2026-11-01" } },
};

const searchedKirkland = (over: Partial<Trace> = {}): Trace => ({
  searches: [{ filters: { ...ANY, city: "KIRKLAND", first_inspected_since: "2026-11-01" }, count: 2, openingSoonCount: 0, ids: ["A", "B"] }],
  summary: "Counting places in Kirkland first inspected since Nov 1: 2.",
  rawPicks: [{ id: "A", blurb: "The only new ramen spot in town." }],
  ...over,
});

describe("numbersIn", () => {
  it("reads digits and small number words", () => {
    expect(numbersIn("Two new places since Nov 1, and 14 overall")).toEqual(expect.arrayContaining([2, 1, 14]));
    expect(numbersIn("No new places this week")).toContain(0);
  });
});

describe("grade", () => {
  it("passes a right answer: filters, count, period, picks and wording", () => {
    const g = grade(KIRKLAND, searchedKirkland());
    expect(g).toMatchObject({
      searched: true, filters: true, count: true, period: true, picks_from_search: true,
      blurb_under_15_words: true, no_opened_on: true, no_markdown: true, mentions: null, never: null,
    });
  });

  it("fails a wrong count, a missing period, a wrong city and an invented pick", () => {
    const g = grade(
      KIRKLAND,
      searchedKirkland({
        searches: [{ filters: { ...ANY, city: "Redmond", first_inspected_since: "2026-11-01" }, count: 2, openingSoonCount: 0, ids: ["A"] }],
        summary: "There are 5 great spots.",
        rawPicks: [{ id: "Z", blurb: "Made up." }],
      }),
    );
    expect(g).toMatchObject({ filters: false, count: false, period: false, picks_from_search: false });
  });

  it("checks the last search, so a corrected retry counts", () => {
    const t = searchedKirkland();
    t.searches.unshift({ filters: { ...ANY, city: "Kirkand" }, count: 0, openingSoonCount: 0, ids: [] });
    expect(grade(KIRKLAND, t).filters).toBe(true);
  });

  it("fails when a question needing no places triggers a search, and skips count checks", () => {
    const c: EvalCase = { id: "help", question: "What can you do?", expect: { search: false } };
    expect(grade(c, { searches: [], summary: "I find new restaurants.", rawPicks: [] })).toMatchObject({
      searched: true, filters: null, count: null, period: null, picks_from_search: null,
    });
    expect(grade(c, searchedKirkland()).searched).toBe(false);
  });

  it("doesn't grade searching when either is fine, but still checks the count after a search", () => {
    const c: EvalCase = { id: "near", question: "What's new near me?", expect: { search: null } };
    expect(grade(c, { searches: [], summary: "Tap the location pin first.", rawPicks: [] })).toMatchObject({ searched: null, count: null });
    expect(grade(c, searchedKirkland()).count).toBe(true);
  });

  it("flags 'opened on', Markdown and long blurbs anywhere in the answer", () => {
    const g = grade(
      KIRKLAND,
      searchedKirkland({
        summary: "**2** places in Kirkland since Nov 1.",
        rawPicks: [{ id: "A", blurb: "It opened on Nov 3 and has a long list of things to say about it today." }],
      }),
    );
    expect(g).toMatchObject({ no_opened_on: false, no_markdown: false, blurb_under_15_words: false });
  });

  it("allows 'opened on' a street, not on a date", () => {
    const blurb = (b: string) => grade(KIRKLAND, searchedKirkland({ rawPicks: [{ id: "A", blurb: b }] })).no_opened_on;
    expect(blurb("Fresh bagel spot that just opened on Western Avenue.")).toBe(true);
    expect(blurb("A new Seattle spot that opened on 7th Avenue South.")).toBe(true);
    expect(blurb("It opened on November 3.")).toBe(false);
    expect(blurb("It opened on 11/3.")).toBe(false);
  });

  it("applies a case's own mentions and never patterns", () => {
    const c: EvalCase = { id: "hours", question: "What are their hours?", expect: { search: false, mentions: ["can'?t|don'?t have|not in"], never: ["\\b\\d{1,2}(am|pm)\\b"] } };
    expect(grade(c, { searches: [], summary: "I don't have hours, only inspections.", rawPicks: [] })).toMatchObject({ mentions: true, never: true });
    expect(grade(c, { searches: [], summary: "Open 9am to 5pm.", rawPicks: [] })).toMatchObject({ mentions: false, never: false });
  });
});

describe("passRates", () => {
  it("counts only runs a check applies to", () => {
    const pass = grade(KIRKLAND, searchedKirkland());
    const fail = grade(KIRKLAND, searchedKirkland({ summary: "Lots of places!" }));
    const rates = passRates([pass, fail]);
    expect(rates.count).toEqual([1, 2]);
    expect(rates.mentions).toEqual([0, 0]);
  });
});
