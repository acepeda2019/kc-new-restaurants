/**
 * Writes the owner's score sheet (SAN-69) from one eval run file. Free: no Claude calls. It runs
 * only when asked (SCORE_SHEET set), so the paid eval never touches it, and it never overwrites
 * a sheet that exists, so scores already ticked are safe.
 *
 *   SCORE_SHEET=evals/runs/2026-11-26-period-rule.jsonl npx vitest run --config evals/vitest.config.ts sheet
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import type { EvalCase, Trace } from "@/evals/graders";
import { answerForReview, scoreSheet } from "@/evals/judge/sheet";
import { loadData } from "@/lib/data";

const EVALS = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(EVALS, "judge", "score-sheet.md");

it.runIf(process.env.SCORE_SHEET)("write the owner's score sheet", () => {
  if (existsSync(OUT)) throw new Error(`${OUT} exists; it may hold scores. Move it aside to write a new one.`);
  const source = process.env.SCORE_SHEET!;
  const cases = JSON.parse(readFileSync(path.join(EVALS, "ask-cases.json"), "utf8")) as EvalCase[];
  const data = loadData(path.join(EVALS, "snapshot"));
  const runs = readFileSync(path.join(EVALS, "..", source), "utf8").trim().split("\n")
    .map((l) => JSON.parse(l) as { case: string; run: number; trace: Trace })
    .filter((r) => r.run === 0);
  const answers = runs.map((r) => answerForReview(cases.find((c) => c.id === r.case)!, r.trace, data));
  writeFileSync(OUT, scoreSheet(answers, source));
  console.log(`Wrote ${answers.length} answers to ${OUT}`);
});
