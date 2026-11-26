/**
 * Question-bar eval (SAN-67): every case in ask-cases.json, EVAL_RUNS times each (default 3),
 * through the production request and answer loop against the frozen snapshot, graded by code.
 *
 * **Spends money** (Haiku 5.5, about 10¢ for 30 cases x 3): ask the owner before running.
 *
 *   ANTHROPIC_API_KEY=… npx vitest run --config evals/vitest.config.ts
 *   EVAL_CASES=kirkland-month,hours EVAL_RUNS=1 …   # a cheap trial
 *
 * Prints a pass-rate table and writes every run to evals/runs/<date>.jsonl.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { it } from "vitest";
import { answer, buildRequest, MODEL, PRICE_PER_MTOK, runFindOpenings, type AskClient } from "@/lib/ask";
import { loadData } from "@/lib/data";
import { CHECKS, grade, passRates, type EvalCase, type Grades, type Trace } from "@/evals/graders";

const HERE = path.dirname(new URL(import.meta.url).pathname);

type Run = { case: string; run: number; trace: Trace; grades: Grades; calls: number; input: number; output: number };

/** One case, once: the real `answer()` loop, with the client and search recorded around it. */
async function runCase(client: Anthropic, c: EvalCase, today: string, data: ReturnType<typeof loadData>): Promise<Omit<Run, "run">> {
  const usage = { calls: 0, input: 0, output: 0 };
  let lastText = "";
  const recording: AskClient = {
    messages: {
      async create(params) {
        const response = await client.messages.create(params);
        if (!response.model.startsWith(MODEL)) throw new Error(`asked for ${MODEL}, got ${response.model}`);
        usage.calls += 1;
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        lastText = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return response;
      },
    },
  };
  const searches: Trace["searches"] = [];
  const search = { openings: data.openings, openingSoon: data.openingSoon, here: c.here, tried: [] };
  const raw = await answer(recording, buildRequest(c.question, { here: c.here, today }), (filters) => {
    const json = runFindOpenings(filters, search);
    const r = JSON.parse(json);
    const ids = [...r.places, ...r.opening_soon].map((p: { id: string }) => p.id);
    searches.push({ filters: filters as Trace["searches"][number]["filters"], count: r.count, openingSoonCount: r.opening_soon_count, ids });
    return json;
  });
  // Claude's own picks, before answer() drops any the search didn't return.
  let rawPicks: Trace["rawPicks"] = [];
  try {
    rawPicks = (JSON.parse(lastText).picks ?? []).filter((p: { id?: unknown }) => typeof p?.id === "string");
  } catch {
    rawPicks = [];
  }
  const trace: Trace = { searches, summary: raw.summary, rawPicks };
  return { case: c.id, trace, grades: grade(c, trace), ...usage };
}

function table(runs: Run[], cases: EvalCase[]): string {
  const pct = ([a, n]: [number, number]) => (n ? `${a}/${n} (${Math.round((100 * a) / n)}%)` : "n/a");
  const rates = passRates(runs.map((r) => r.grades));
  const lines = ["| Check | Passed |", "|---|---|", ...CHECKS.map((c) => `| ${c} | ${pct(rates[c])} |`), ""];
  lines.push("| Case | Failed checks (runs) |", "|---|---|");
  for (const c of cases) {
    const mine = runs.filter((r) => r.case === c.id);
    const failed = CHECKS.map((k) => [k, mine.filter((r) => r.grades[k] === false).length] as const).filter(([, n]) => n);
    lines.push(`| ${c.id} | ${failed.map(([k, n]) => `${k} (${n}/${mine.length})`).join(", ") || "none"} |`);
  }
  const tokens = { input: runs.reduce((s, r) => s + r.input, 0), output: runs.reduce((s, r) => s + r.output, 0) };
  const cost = (tokens.input * PRICE_PER_MTOK.input + tokens.output * PRICE_PER_MTOK.output) / 1e6;
  const calls = runs.reduce((s, r) => s + r.calls, 0);
  lines.push("", `${runs.length} runs, ${calls} calls, ${tokens.input} input + ${tokens.output} output tokens, $${cost.toFixed(4)}`);
  return lines.join("\n");
}

it("question bar against fixed cases", { timeout: 30 * 60_000 }, async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY: this eval calls Claude (and spends money).");
  const data = loadData(path.join(HERE, "snapshot"));
  const only = process.env.EVAL_CASES?.split(",").filter(Boolean);
  const all = JSON.parse(readFileSync(path.join(HERE, "ask-cases.json"), "utf8")) as EvalCase[];
  const cases = only ? all.filter((c) => only.includes(c.id)) : all;
  const times = Number(process.env.EVAL_RUNS ?? 3);
  const client = new Anthropic({ timeout: 20_000, maxRetries: 2 });

  const jobs = cases.flatMap((c) => Array.from({ length: times }, (_, run) => ({ c, run })));
  const runs: Run[] = [];
  // A few at a time: fast enough, gentle on rate limits.
  for (let i = 0; i < jobs.length; i += 4) {
    const batch = jobs.slice(i, i + 4);
    runs.push(...(await Promise.all(batch.map(async ({ c, run }) => ({ ...(await runCase(client, c, data.manifest.run_date, data)), run })))));
  }

  const out = path.join(HERE, "runs");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${new Date().toISOString().slice(0, 10)}.jsonl`), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\nSnapshot ${data.manifest.run_id}, today ${data.manifest.run_date}, ${MODEL}\n\n${table(runs, cases)}\n`);
});
