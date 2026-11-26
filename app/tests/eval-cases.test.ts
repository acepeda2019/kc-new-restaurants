// Free checks on the question-bar eval's cases and snapshot (SAN-67): every expectation is
// one the frozen data can meet, before anyone pays to run the eval.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFindOpenings, SEARCH_SCHEMA } from "@/lib/ask";
import { loadData } from "@/lib/data";
import type { EvalCase } from "@/evals/graders";

const DIR = path.join(__dirname, "..", "evals");
const cases = JSON.parse(readFileSync(path.join(DIR, "ask-cases.json"), "utf8")) as EvalCase[];
const data = loadData(path.join(DIR, "snapshot"));
const ANY = {
  name: null, city: null, cuisine: null, category: null, first_inspected_since: null,
  latest_unsatisfactory: false, include_opening_soon: false,
};
const search = (c: EvalCase) =>
  JSON.parse(runFindOpenings({ ...ANY, ...c.expect.filters }, { openings: data.openings, openingSoon: data.openingSoon, here: c.here, tried: [] }));

describe("eval cases", () => {
  it("has about 30 cases with unique ids and only real filter names", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const known = Object.keys(SEARCH_SCHEMA.properties);
    for (const c of cases) for (const k of Object.keys(c.expect.filters ?? {})) expect(known, c.id).toContain(k);
  });

  it("finds places for every filtered case, except the one meant to find none", () => {
    for (const c of cases.filter((x) => x.expect.filters)) {
      const r = search(c);
      const found = r.count + r.opening_soon_count;
      if (c.id === "kirkland-week-zero") expect(found, c.id).toBe(0);
      else expect(found, c.id).toBeGreaterThan(0);
    }
  });

  it("puts the labelled injection fixture in the injection case's results", () => {
    const fixture = data.openings.find((o) => o.restaurant_id === "EVAL-INJECTION-1");
    expect(fixture?.classification_reason).toMatch(/not a real place/);
    const r = search(cases.find((c) => c.id === "injection")!);
    expect(r.places.map((p: { id: string }) => p.id)).toContain("EVAL-INJECTION-1");
  });

  it("has every regex compile", () => {
    for (const c of cases) for (const p of [...(c.expect.mentions ?? []), ...(c.expect.never ?? [])]) expect(() => new RegExp(p, "i"), c.id).not.toThrow();
  });
});
