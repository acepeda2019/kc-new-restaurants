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
  re-check the cases when you do. It holds one row that isn't real: `EVAL-INJECTION-1`, a
  Seattle "Thai" place whose name tries to give Claude orders, labelled as an eval fixture by
  its id and its `classification_reason` (a field Claude never sees: the first baseline showed a
  label in `why` made Claude skip the place for being a fixture, which tests nothing). It exists
  only here, never in the app's data. `tests/eval-cases.test.ts` checks (free)
  that every case's filters find places in the snapshot.
- `runs/<date>.jsonl`: every run's searches, summary, picks, grades and tokens.
- `judge/` (SAN-69): the owner's hand scores, which a model judge must agree with before it
  is trusted. `judge/score-sheet.md` shows run 0 of a run file the way the cards look, with
  three yes/no boxes per answer (`RUBRIC` in `judge/sheet.ts`). Writing a new sheet is free
  and never overwrites one that exists:
  `SCORE_SHEET=evals/runs/<file>.jsonl npx vitest run --config evals/vitest.config.ts sheet`.
  The judge (`judge/judge.ts`, Haiku 5.5) sees each answer exactly as the sheet shows it. It is
  trusted only while it agrees with the owner on at least 80% of answers for every item; if
  not, fix the rubric, never the scores. **Spends money** (about half a cent):
  `JUDGE=1 ANTHROPIC_API_KEY=… npx vitest run --config evals/vitest.config.ts judge` prints
  agreement and each disagreement, and writes `judge/runs/<date>.jsonl`.
