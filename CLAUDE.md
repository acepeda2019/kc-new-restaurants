# King County New Eats: Claude Code guide

A private app for the owner and a few friends that answers:

> **What restaurants just opened near me in King County, WA, and why is each worth a look?**

It doubles as a portfolio piece: governed dbt models with tests, classification logic and a
usable app, in a form a reviewer grasps quickly.

## Where things live

| Question | File |
|---|---|
| How does the system work now? | **`ARCHITECTURE.md`**: the single source of truth. Review all code against it. |
| Why was something chosen? | `docs/decisions.md`: dated log, newest first |
| How did we get here? | `docs/superpowers/`: dated designs and plans. **Frozen history, not current.** |
| What does a source look like? | `docs/source_cards/` |

Read `ARCHITECTURE.md` before any non-trivial task. If a request conflicts with it, say so
and ask; never change scope silently. A PR that changes behaviour described there updates
`ARCHITECTURE.md` in the same PR and adds a `docs/decisions.md` entry.

## Repo layout

```
ingestion/            # Python: extractors (one module per source) + CLI runner
  sources/<source>.py
  tests/
transform/            # dbt project (DuckDB): staging → intermediate → marts, seeds, export
app/                  # Next.js app (UI from v0) on Vercel
  data/sample/        # labelled sample JSON for local and v0 development
infra/                # Terraform: S3 raw bucket + GitHub OIDC role only
exploration/          # profiling scripts (not production)
docs/                 # decisions.md, source_cards/, superpowers/ (history)
.claude/agents/       # subagent definitions
.github/workflows/
```

## Conventions

**Python (ingestion)**
- `uv` for environments (Python 3.12), `ruff` for lint and format, type hints on public functions.
- Extractors only extract. They land data as received at
  `s3://<bucket>/raw/<source>/dt=YYYY-MM-DD/<run_id>.<ext>`, write-once. No cleaning here.
- Every extractor is idempotent for a given date, logs row counts, and uses timeouts,
  retries with backoff and polite paging.

**dbt (transform)**
- Layers and naming: `stg_<source>__<entity>` (1:1 with source; rename, cast, dedupe only)
  → `int_<purpose>` → `mart_<purpose>`.
- Only `ref()` and `source()`; no hard-coded schema names.
- Every model has a YAML entry stating its **grain**, plus `unique` + `not_null` on its key.
  Every source has freshness.
- Rules, thresholds and weights live in seeds, never hard-coded in SQL.
- SQL: lowercase keywords, CTEs (import CTEs first, final `select` last), explicit column
  lists in marts.

**Claude API**
- Model `claude-haiku-5-5` everywhere. Before writing a Claude call, read the `claude-api`
  skill and use only documented SDK calls.

## Guardrails (non-negotiable)

1. **Cost is capped, never open-ended.** The only request-time Claude call is `/api/ask`,
   and it checks the caps (global and per-visitor daily, question length, `max_tokens`)
   *before* calling Claude, failing closed. No other API routes except `/api/login`. Pages
   are static and visitors never touch S3 or the pipeline. The whole site sits behind the
   passcode.
2. **Google Places terms:** never store Places content beyond `place_id` (later scope).
3. **Secrets** never enter the repo: GitHub Actions secrets and Vercel env vars only.
4. **Ask before** `terraform apply`, deleting S3 data, force-pushing, or anything that costs
   money.
5. **No invented data.** Placeholders are labelled as sample data. Inferred values are
   labelled ("likely Indian").

## Subagent workflow

Use the agents in `.claude/agents/` for these jobs:

| Step | Agent | Output |
|---|---|---|
| Understand a new source | `data-profiler` | `docs/source_cards/<source>.md` |
| Write extract code | `ingestion-engineer` | `ingestion/` + tests |
| Write dbt models and tests | `dbt-modeler` | `transform/` |
| Infra and CI | `infra-engineer` | `infra/`, `.github/workflows/` |
| Build the app | `app-builder` | `app/` |
| Check the data | `data-qa` | QA report (does not fix code) |
| Check work against `ARCHITECTURE.md` | `spec-reviewer` | review report (does not fix code) |
| Docs and decision log | `docs-writer` | `ARCHITECTURE.md`, README, `docs/` |

Reviewers and QA must not have written the work they check.

## Pull requests and auto-merge

Work goes on a branch and lands through a PR into `main` (merge commit; the branch is
deleted after merge). Descriptions follow `.github/pull_request_template.md`: one bold
sentence first, then what changes from before, then why.

Claude **may merge its own PR without asking** only when all of these hold:

1. **Small:** under 200 changed lines (additions + deletions as reported by
   `gh pr view --json additions,deletions`), counting code and docs alike.
2. **Not breaking.** A PR is breaking if it:
   - changes a model's grain, key or the meaning of a column, or removes or renames a
     column in a mart or the app JSON;
   - changes classification rules, scoring, the confidence threshold, caps, or the scope
     in `ARCHITECTURE.md`;
   - changes the guardrails or this auto-merge rule;
   - changes Terraform in a way that destroys or replaces a resource, or alters IAM,
     secrets or cost limits;
   - changes the S3 raw layout.
3. **Checks pass:** every required GitHub check is green, and the PR's definition-of-done
   items are met.

If any condition fails, or Claude is unsure, open the PR and ask the owner. When Claude
auto-merges, it says so in its reply, with the PR link and size.

## Definition of done (any change)

- Matches `ARCHITECTURE.md`, or updates it plus `docs/decisions.md` with the owner's OK.
- `dbt build` passes for affected models; new models have grain and key tests.
- Extractors have a unit test with a recorded sample response; app logic has unit tests.
- `data-qa` and `spec-reviewer` reports have no open blocking issues.
- Docs updated: source card, model YAML descriptions, README if user-facing.
