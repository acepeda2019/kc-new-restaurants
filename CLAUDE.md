# King County New Eats — Claude Code guide

A portfolio analytics-engineering project. It answers one question for diners:

> **What are the new and upcoming restaurants I should try in King County, WA?**

It also has to show, to an interviewer reading the repo, a production-style
pipeline: ingestion → raw storage → governed transformation → a small public app.

**`docs/PROJECT_SPEC.md` is the source of truth** for scope, sources, data model,
scoring and milestones. Read it before any non-trivial task. If a request
conflicts with the spec, say so and ask before proceeding; never change scope
silently. Record every design decision in `docs/decisions.md`.

## Stack

| Layer | Tool |
|---|---|
| Scheduling | AWS EventBridge Scheduler → Step Functions (extracts, then GitHub `repository_dispatch`) |
| Extract | Python on AWS Lambda (one handler per source) |
| Raw storage | S3, immutable dated files |
| Load | `COPY INTO` Snowflake `RAW` at the start of the pipeline job (no Snowpipe) |
| Transform | dbt Core (Snowflake adapter), run by GitHub Actions on `repository_dispatch` (no GitHub cron) |
| Export | Snowflake `COPY INTO` S3 stage: app marts → JSON at `s3://<bucket>/exports/` |
| App | Next.js (UI generated with v0), static build on Vercel; reads JSON exports from S3 at build time only |
| Infra | Terraform (AWS + Snowflake providers) |
| CI | GitHub Actions: lint, `dbt build` on changed models, `terraform plan` |
| Local exploration | DuckDB |

## Repo layout

```
ingestion/            # Python extractors, one module per source; Lambda handlers
  sources/<source>.py
  tests/
transform/            # dbt project
  models/staging/<source>/
  models/intermediate/
  models/marts/
  seeds/              # score weights, ZIP→area, classification rules, venue exclusions, overrides
  snapshots/
infra/                # Terraform: S3, IAM, Lambda, EventBridge, Snowflake objects
app/                  # Next.js app (UI from v0); lib/data.ts reads JSON exports at build time
  data/sample/        # labelled sample JSON for local and v0 development
exploration/          # DuckDB notebooks/scripts used for profiling (not production)
docs/
  PROJECT_SPEC.md
  decisions.md
  source_cards/       # one card per source, written from profiling
.claude/agents/       # subagent definitions
.github/workflows/
```

Folders that don't exist yet are planned; create them as milestones need them.

## Conventions

**Python (ingestion)**
- Environment with `uv`; lint/format with `ruff`; type hints on public functions.
- Extractors only extract. Land data as-received (JSONL or Parquet) at
  `s3://<bucket>/raw/<source>/dt=YYYY-MM-DD/<run_id>.<ext>`. No cleaning here.
- Every extractor is idempotent and re-runnable for a given date, supports a
  full-pull mode and, where the source supports it, an incremental window
  with a lookback (default 14 days), and logs row counts. KC inspections are
  pulled in full every run (`:updated_at` is unusable there).
- Network calls: timeouts, retries with backoff, polite paging.

**dbt (transform)**
- Layers and naming: `stg_<source>__<entity>` (1:1 with source, rename/cast/dedupe
  only) → `int_<purpose>` → `dim_`, `fct_`, `mart_`.
- Only `ref()` and `source()`; no hard-coded schema names.
- Every model has a YAML entry stating its **grain** in the description, plus
  `unique` + `not_null` tests on its primary key. Every source has freshness.
- Surrogate keys via `dbt_utils.generate_surrogate_key`.
- Score weights, ZIP→area mapping, category/notice-type
  classification rules, press-match rules and entity/press-match overrides live in seeds, never
  hard-coded in SQL.
- SQL: lowercase keywords, CTEs (import CTEs first, final `select` last),
  explicit column lists in marts.

**Snowflake**
- Schemas: `RAW`, `STAGING`, `INTERMEDIATE`, `MARTS` (prod); dev and CI use
  per-developer and per-PR schema prefixes.
- One XS warehouse, `auto_suspend = 60`, resource monitor with a hard monthly
  quota of about $10 in credits (suspend at 100%).
- `int_restaurant_id_map` is persisted state (`full_refresh: false`). Never
  drop, rebuild or full-refresh it without the owner's OK.

## Guardrails (non-negotiable)

1. **Cost stays bounded by schedules, never by traffic.** No always-on compute.
   The public app is static; visitors must never trigger warehouse queries or
   paid API calls. No live AI/LLM features in the public app.
   The app **never connects to Snowflake.** It reads JSON exports from
   `s3://<bucket>/exports/latest/` **only at build time**: pages are static
   (`revalidate = false`), rebuilt by a Vercel deploy hook after a passing
   `dbt build` and export. No `force-dynamic` pages and no API routes.
   The read-only S3 key lives only in server-side Vercel env vars, never
   `NEXT_PUBLIC_*`.
2. **Google Places terms:** never store Places content (ratings, names,
   addresses) beyond `place_id`. Out of scope until milestone 5 anyway.
3. **Secrets** never enter the repo. Use GitHub Actions secrets locally mirrored
   in an untracked `.env`; AWS Secrets Manager for Lambda.
4. **Ask before** `terraform apply`, dropping/replacing Snowflake objects,
   deleting S3 data, force-pushing, or anything that costs money.
5. **No invented data.** Placeholders are labelled as sample data.

## Subagent workflow

Use the agents in `.claude/agents/` for these jobs:

| Step | Agent | Output |
|---|---|---|
| Understand a new source | `data-profiler` | `docs/source_cards/<source>.md` |
| Write extract code | `ingestion-engineer` | `ingestion/` + tests |
| Write dbt models/tests | `dbt-modeler` | `transform/` |
| Infra and CI | `infra-engineer` | `infra/`, `.github/workflows/` |
| Build app pages | `app-builder` | `app/` |
| Check the data | `data-qa` | QA report (does not fix code) |
| Check work against the spec | `spec-reviewer` | Review report (does not fix code) |
| Docs and decision log | `docs-writer` | README, docs/ |

Default loop for any feature: **profile (if new data) → build → data-qa →
spec-reviewer → fix → docs-writer.** Exception: during milestone 1 the loop
is **profile → build → data-qa**; the full loop applies from milestone 2. The reviewer and QA agents must not have
written the work they check. Run independent build tasks in parallel only when
they touch different folders.

## Definition of done (any change)

- Spec-aligned (or the spec and `docs/decisions.md` updated, with the user's OK).
- `dbt build` passes for affected models; new models have grain + key tests.
- Extractors have a unit test with a recorded sample response.
- `data-qa` and `spec-reviewer` reports have no open blocking issues.
- Docs updated: source card, model YAML descriptions, README if user-facing.
