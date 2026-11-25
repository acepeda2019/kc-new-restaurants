# Question-bar eval (SAN-67)

Fixed questions run through the production request and answer loop (`lib/ask.ts`), graded by
code (`graders.ts`, unit-tested in `tests/eval-graders.test.ts`). **It calls Claude and spends
money** (about 10¢ for 30 cases x 3 runs), so it is outside `npm test` and CI.

```bash
ANTHROPIC_API_KEY=… npx vitest run --config evals/vitest.config.ts
EVAL_CASES=kirkland-month EVAL_RUNS=1 ANTHROPIC_API_KEY=… npx vitest run --config evals/vitest.config.ts
```

- `ask-cases.json`: each case's question and what a right answer must show (filters, count and
  period, phrases it must or must never use).
- `snapshot/`: a **frozen copy of the real export of 2026-11-25** (520 places), so expected
  counts don't drift. "Today" is the snapshot's `run_date`. Refresh it only on purpose, and
  re-check the cases when you do.
- `runs/<date>.jsonl`: every run's searches, summary, picks, grades and tokens.
