/**
 * Judges the answers on the owner's score sheet and reports how often the judge agrees (SAN-69).
 * **Spends money** (Haiku 5.5, about half a cent for 31 answers): ask the owner before running.
 * Runs only with JUDGE set, so the main eval never starts it.
 *
 *   JUDGE=1 ANTHROPIC_API_KEY=… npx vitest run --config evals/vitest.config.ts judge
 *
 * Prints agreement per rubric item and every disagreement with the judge's reason, and writes
 * the judge's scores to evals/judge/runs/<date>.jsonl.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { it } from "vitest";
import type { EvalCase, Trace } from "@/evals/graders";
import { agreement, AGREEMENT_BAR, judgeAnswer, type Judgement } from "@/evals/judge/judge";
import { answerForReview, parseScoreSheet, RUBRIC } from "@/evals/judge/sheet";
import { MODEL, PRICE_PER_MTOK } from "@/lib/ask";
import { loadData } from "@/lib/data";

const EVALS = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

it.runIf(process.env.JUDGE)("judge agrees with the owner's scores", { timeout: 10 * 60_000 }, async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY: the judge calls Claude (and spends money).");
  const sheet = readFileSync(path.join(EVALS, "judge", "score-sheet.md"), "utf8");
  if (!/^- \[[xX]\]/m.test(sheet)) throw new Error("score-sheet.md has no ticks yet: the owner scores it first.");
  const source = sheet.match(/^Answers from `([^`]+)`/m)?.[1];
  if (!source) throw new Error("score-sheet.md doesn't say which run file it came from.");
  const owner = parseScoreSheet(sheet);

  const cases = JSON.parse(readFileSync(path.join(EVALS, "ask-cases.json"), "utf8")) as EvalCase[];
  const data = loadData(path.join(EVALS, "snapshot"));
  const answers = readFileSync(path.join(EVALS, "..", source), "utf8").trim().split("\n")
    .map((l) => JSON.parse(l) as { case: string; run: number; trace: Trace })
    .filter((r) => r.run === 0 && owner.has(r.case))
    .map((r) => answerForReview(cases.find((c) => c.id === r.case)!, r.trace, data));

  const client = new Anthropic({ timeout: 20_000, maxRetries: 2 });
  const judged = new Map<string, Judgement>();
  for (let i = 0; i < answers.length; i += 4) {
    const batch = answers.slice(i, i + 4);
    const results = await Promise.all(batch.map((a) => judgeAnswer(client, a)));
    batch.forEach((a, n) => judged.set(a.case, results[n]));
  }

  const out = path.join(EVALS, "judge", "runs");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    [...judged].map(([id, j]) => JSON.stringify({ case: id, source, ...j })).join("\n") + "\n",
  );

  const rows = agreement(new Map([...owner].map(([id, o]) => [id, o.scores])), new Map([...judged].map(([id, j]) => [id, j.scores])));
  const pct = (a: number, n: number) => (n ? `${Math.round((100 * a) / n)}%` : "n/a");
  const lines = [`| Item | Agrees | Owner said yes | Trusted (≥ ${AGREEMENT_BAR * 100}%) |`, "|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.key} | ${r.agree}/${r.n} (${pct(r.agree, r.n)}) | ${pct(r.ownerYes, r.n)} | ${r.trusted ? "yes" : "no"} |`);
  lines.push("", "Disagreements (owner → judge, with the judge's reason):");
  for (const [id, j] of judged) {
    const o = owner.get(id)!;
    for (const { key } of RUBRIC) {
      if (o.scores[key] === null || j.scores[key] === null || o.scores[key] === j.scores[key]) continue;
      const note = o.note ? ` (owner's note: ${o.note})` : "";
      lines.push(`* ${id} ${key}: ${o.scores[key] ? "yes" : "no"} → ${j.scores[key] ? "yes" : "no"}. ${j.reasons[key]}${note}`);
    }
  }
  const input = [...judged.values()].reduce((s, j) => s + j.input, 0);
  const output = [...judged.values()].reduce((s, j) => s + j.output, 0);
  const cost = (input * PRICE_PER_MTOK.input + output * PRICE_PER_MTOK.output) / 1e6;
  lines.push("", `${judged.size} answers judged by ${MODEL}, ${input} input + ${output} output tokens, $${cost.toFixed(4)}`);
  console.log(`\n${lines.join("\n")}\n`);
});
