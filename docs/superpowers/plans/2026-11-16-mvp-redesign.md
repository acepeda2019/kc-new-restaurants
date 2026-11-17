# King County New Eats MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, phone-friendly web app showing King County restaurants first inspected in the last 180 days on a map, with headline metrics, a personal top 3 and a capped Claude Haiku question bar.

**Architecture:** One daily GitHub Actions job runs the existing Python extractors (KC inspections, Census geocoder) into S3 raw, asks Claude Haiku to classify only new candidate openings, builds dbt models in DuckDB and deploys a Next.js app to Vercel with the day's JSON baked in. The app is gated by a shared passcode; `/api/ask` enforces global and per-visitor daily caps in Upstash Redis before calling Haiku.

**Tech Stack:** Python 3.12 + uv + ruff + pytest; Anthropic Python SDK; dbt-core + dbt-duckdb (httpfs/aws extensions); Next.js (App Router, TypeScript) + vitest; MapLibre GL; `@upstash/redis`; Anthropic TypeScript SDK; Vercel CLI; Terraform (S3 + GitHub OIDC only).

**Spec:** `docs/superpowers/specs/2026-11-16-mvp-redesign-design.md` (read it first; `docs/PROJECT_SPEC.md` §6–7 and `docs/source_cards/` hold the data rules it references).

## Global Constraints

- Claude model everywhere: `claude-haiku-5-5`. Before writing any Claude call, read the `claude-api` skill's `python/claude-api/README.md` or `typescript/claude-api/README.md` and use only documented SDK calls (structured outputs via `output_config.format`; no prefill; no `temperature`).
- Question bar answers: thinking disabled (`{type: "disabled"}`, allowed on Haiku 5.5 at effort `high` or below), `output_config.effort: "low"`, `max_tokens: 400`. Verify against the README; if `disabled` is rejected, use adaptive thinking at `low` effort and `max_tokens: 1200`.
- Caps (env vars, these defaults): `ASK_DAILY_CAP_GLOBAL=200`, `ASK_DAILY_CAP_VISITOR=20`, `ASK_MAX_QUESTION_CHARS=500`. Day boundary = America/Los_Angeles date.
- Answer style: at most 3 recommendations, one line of reason each; inferred cuisine always written "likely <cuisine>"; never call a place "good" or "best"; "wary" answers cite inspection date + red critical points; say plainly when data can't answer (hours, price, ratings, opening soon).
- Secrets only in GitHub Actions secrets and Vercel env vars: `ANTHROPIC_API_KEY`, `APP_PASSCODE`, `AUTH_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, AWS via OIDC role `AWS_ROLE_ARN` (repo variable). Use a dedicated Anthropic API key for this app.
- Raw layout unchanged: `s3://$RAW_BUCKET/raw/<source>/dt=YYYY-MM-DD/<run_id>...`, write-once (`If-None-Match: *`). New source `claude_classifications` follows it.
- dbt conventions from `CLAUDE.md`: `stg_<source>__<entity>` → `int_` → `mart_`; YAML grain + `unique`/`not_null` on every PK; rules and weights in seeds; lowercase SQL with CTEs.
- `restaurant_id` = KC `business_id`.
- Inclusion window 180 days on first inspection date; confidence threshold seed `min_confidence = 0.8`.
- Score: `100 × (0.6·freshness + 0.4·safety)`, `freshness = 0.5 ^ (days_since_first_inspection / 30)`, `safety = greatest(0, 1 − first_inspection_red_points / 50)`; weights and the 50 in `seeds/score_params.csv`.
- PRs ~200 changed lines, hard ceiling 400 (excluding lock files and generated code). One task = one PR = one Linear ticket. `terraform apply` is run by the owner only.

## Review Focus

1. **A bad or empty KC pull** (dataset republished under a new ID, API returns 0 rows): the publish step must refuse to deploy when `mart_new_openings` has 0 rows or fewer than 50% of the previous export's rows, so the site keeps the last good data. Test in Task 7.
2. **Claude fails for some candidates** (API error, refusal, malformed output): those candidates are left unclassified and stay out of the app; the job still succeeds and logs the count; the next run retries them. Test in Task 5.
3. **Visitor denies location**: top 3 falls back to score order with no distances shown; "near me" questions get "Share your location to use 'near me'." Tests in Tasks 9 and 10.
4. **Upstash unreachable or caps exhausted**: `/api/ask` fails closed (HTTP 429 with a friendly message), never calls Claude uncounted. Test in Task 10.
5. **Prompt injection** via a restaurant name or a question ("ignore your rules", "list everything"): data goes in a delimited block marked as data; system prompt says answers come only from it, max 3 items; questions over 500 chars rejected before any call. Test in Task 10.

---

### Task 1: Remove the old architecture and add the minimal S3 + OIDC Terraform

**Files:**
- Delete: `infra/` (all except `infra/bootstrap/` and `infra/README.md`), `ingestion/handlers/`, `ingestion/sources/dispatch.py`, `ingestion/tests/test_dispatch.py`, `ingestion/tests/test_handlers.py`, `ingestion/build.sh`, `.github/workflows/pipeline.yml`
- Create: `infra/main.tf`, `infra/variables.tf`, `infra/outputs.tf`, `infra/versions.tf`
- Modify: `infra/README.md`, `.github/workflows/terraform.yml`, `ingestion/pyproject.toml` (drop `moto[secretsmanager]` extra and the dispatch description), `.gitignore` if it lists removed paths

**Interfaces:**
- Produces: S3 bucket `var.bucket_name` (versioning on, public access blocked, lifecycle: none), IAM role assumable by GitHub OIDC for `repo:<owner>/kc-new-restaurants:ref:refs/heads/main` and `workflow_dispatch`, with `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the bucket. Outputs `raw_bucket`, `github_role_arn`.

- [ ] **Step 1:** Delete the listed files; `cd ingestion && uv run pytest` → PASS (remaining tests: common, kc_inspections, census_geocoder, geocode_key).
- [ ] **Step 2:** Write the four `infra/*.tf` files (reuse the bucket and OIDC blocks from the deleted `s3.tf` / `iam_github.tf` in git history; drop Snowflake/Vercel/Lambda principals from the bucket policy, keep the write-once deny on `raw/*`).
- [ ] **Step 3:** `cd infra && terraform fmt -check && terraform init -backend=false && terraform validate` → "Success! The configuration is valid." Update `terraform.yml` to run only fmt/validate (no plan; no credentials in CI).
- [ ] **Step 4:** Rewrite `infra/README.md` to the two resources and the owner-only apply steps.
- [ ] **Step 5:** Commit `chore: remove Step Functions/Lambda/Snowflake stack; keep S3 + GitHub OIDC`. PR needs owner review (destroys planned resources, changes IAM).

### Task 2: Update the spec, decision log and CLAUDE.md to the MVP

**Files:**
- Modify: `docs/PROJECT_SPEC.md` (§3 scope, §5 architecture, §8 milestones, §9 cost), `docs/decisions.md` (new top entries), `CLAUDE.md` (stack table, repo layout, guardrail 1, subagent workflow, definition of done), `README.md`

- [ ] **Step 1:** Add decision entries dated 2026-11-16: lean MVP replaces AWS/Snowflake stack; Just opened only (Opening soon later); Claude Haiku judgment calls with confidence + overrides seed (rules first); live question bar with hard caps replaces "no live AI" (supersedes 2026-11-06 entry); Next.js on Vercel deployed from Actions with baked-in JSON (supersedes S3 export entry); `restaurant_id` = KC `business_id` (persisted ID map deferred); dbt on DuckDB.
- [ ] **Step 2:** Rewrite `CLAUDE.md` guardrail 1 to: static pages + one `/api/ask` route + `/api/login`; Claude only via `/api/ask` with the caps in Global Constraints; whole site behind passcode. Keep guardrails 2–5. Replace the stack table with this plan's Tech Stack.
- [ ] **Step 3:** Update spec sections to point at the design doc rather than duplicate it.
- [ ] **Step 4:** Commit `docs: rescope spec, decisions and CLAUDE.md to the lean MVP`. PR needs owner review (changes guardrails and scope).

### Task 3: Run the extractors from the command line

**Files:**
- Create: `ingestion/run.py`, `ingestion/tests/test_run.py`
- Modify: `ingestion/README.md`

**Interfaces:**
- Consumes: `sources.kc_inspections.extract(*, bucket, run_date, run_id, s3, app_token, force) -> dict`, `sources.census_geocoder.extract(*, bucket, run_date, run_id, kc_keys, s3) -> dict`, `sources.common.{env, resolve_run_date, new_run_id, s3_client, configure_logging}`.
- Produces: CLI `uv run python run.py extract [--run-date YYYY-MM-DD] [--run-id ID] [--force]` → runs KC then geocoder (geocoder gets the KC result's `s3_keys`), prints one JSON line per step result, exits 1 on any exception. Function `run_extract(run_date: str, run_id: str, force: bool, s3: Any) -> list[dict]`.

- [ ] **Step 1:** Write `test_run.py::test_run_extract_passes_kc_keys_to_geocoder` (monkeypatch both `extract` functions; assert geocoder called with `kc_keys == kc_result["s3_keys"]` and the same `run_id`) and `test_cli_exits_1_on_failure` (KC extract raises → `SystemExit` code 1).
- [ ] **Step 2:** `cd ingestion && uv run pytest tests/test_run.py -v` → FAIL (no module `run`).
- [ ] **Step 3:** Implement `run.py` with argparse; `RAW_BUCKET` via `env(required=True)`; `SOCRATA_APP_TOKEN` optional.
- [ ] **Step 4:** `uv run pytest -v && uv run ruff check .` → all PASS.
- [ ] **Step 5:** Commit `feat(ingestion): CLI to run KC extract and geocoder in sequence`.

### Task 4: dbt project, staging models and candidate selection

**Files:**
- Create: `transform/dbt_project.yml`, `transform/profiles.yml`, `transform/packages.yml` (dbt_utils), `transform/pyproject.toml` (dbt-core, dbt-duckdb), `transform/models/staging/kc/{_kc__sources.yml,_kc__models.yml,stg_kc__inspection_violations.sql,stg_kc__inspections.sql}`, `transform/models/staging/census/{_census__sources.yml,_census__models.yml,stg_census__geocodes.sql}`, `transform/models/intermediate/{_int__models.yml,int_establishments.sql,int_candidates.sql}`, `transform/seeds/{classification_rules.csv,venue_exclusions.csv,_seeds.yml}`, `transform/tests/assert_geocode_key_matches_requests.sql`, `transform/data/sample/` (small checked-in sample raw files, labelled sample)

**Interfaces:**
- Consumes: raw layout from Tasks 1/3. dbt var `raw_root` (default `s3://{{ env_var('RAW_BUCKET') }}/raw`; local runs set `--vars '{raw_root: data/sample/raw}'`).
- Produces:
  - `stg_kc__inspection_violations` (grain: violation row; key surrogate of serial + description + row presence), latest KC file only (max `dt`, then max run_id).
  - `stg_kc__inspections` (grain: `inspection_serial_num`): business_id, inspection_date, inspection_type, inspection_result, inspection_score, closed_business, red_points (sum of RED violation_points).
  - `stg_census__geocodes` (grain: `geocode_key`): latest response per key; `match_status`, `latitude`, `longitude`, `matched_address`. Parse ragged CSV with `read_csv(..., header=false, null_padding=true, all_varchar=true)`.
  - `int_establishments` (grain: `business_id`): name, program_identifier, address, city_normalized, zip5, classification, `geocode_key` (canonical v1 rule in DuckDB SQL from `sources/geocode_key.py` docstring; `regexp_replace(..., '\s+', ' ', 'g')`), latitude, longitude, first_inspection_date, first_inspection_result, first_inspection_red_points, latest_inspection_date, latest_red_points, is_multi_tenant (>1 business_id active at same geocode_key in last 12 months), rule_category (from `classification_rules.csv`: `restaurant` | `food_truck` | `needs_judgment` | `excluded`), is_venue_excluded.
  - `int_candidates` (grain: `business_id`): rows of `int_establishments` with first_inspection_date within 180 days of the run date, rule_category ≠ `excluded`, not venue-excluded, first result not "Unsatisfactory", not closed by inspection; plus `prior_businesses_at_address` (JSON list of name + last inspection date for other business_ids at the same geocode_key in the prior 12 months).
- `classification_rules.csv` columns `classification,rule_category` covering all 15 KC classification values in the source card; "Bakery" and "Limited Food Service" → `needs_judgment`; "General Food Services" → `needs_judgment` (café vs restaurant is Claude's call); "Mobile Food Unit" → `food_truck`. `venue_exclusions.csv` columns `geocode_key,venue_name` from the profiling (Lumen Field, T-Mobile Park, Climate Pledge Arena, SeaTac airport terminals).

- [ ] **Step 1:** Add sample raw files (≈200 KC rows covering a new opening, a new concept, an ownership transfer, a truck, a grocery bakery, a stadium vendor; matching geocoder request/response CSVs).
- [ ] **Step 2:** Write YAML tests first: PK `unique`/`not_null` on all five models; `accepted_values` on `rule_category`; `assert_geocode_key_matches_requests.sql` returns KC addresses whose computed key is missing from the geocoder request files' keys (expect 0 rows on sample); `int_candidates` has no `rule_category = 'excluded'`.
- [ ] **Step 3:** `cd transform && uv run dbt deps && uv run dbt build --vars '{raw_root: data/sample/raw}'` → FAIL (models missing).
- [ ] **Step 4:** Write the models and seeds.
- [ ] **Step 5:** Same command → PASS, `int_candidates` contains the new opening, new concept, truck and bakery fixtures and not the stadium vendor or grocery.
- [ ] **Step 6:** Commit `feat(transform): dbt-duckdb project with KC/Census staging and candidate selection`. If over 400 lines, split staging (4a) from intermediate + seeds (4b).

### Task 5: Claude classification step

**Files:**
- Create: `ingestion/sources/claude_classifications.py`, `ingestion/tests/test_claude_classifications.py`, `ingestion/tests/fixtures/claude/` (recorded responses)
- Modify: `ingestion/run.py` (new subcommand), `ingestion/pyproject.toml` (add `anthropic`, `duckdb`)

**Interfaces:**
- Consumes: `int_candidates` read from the dbt DuckDB file (`transform/kcne.duckdb`, path via `--db`), `rule_category`, prior classifications under `raw/claude_classifications/`.
- Produces: CLI `uv run python run.py classify --db ../transform/kcne.duckdb [--run-date] [--run-id] [--limit N]`. Function `classify_candidates(candidates: list[dict], prior: dict[str, str], client: anthropic.Anthropic) -> tuple[list[dict], int]` returning (classification records, failed count). Lands `raw/claude_classifications/dt=YYYY-MM-DD/<run_id>.jsonl.gz`, one line per business:
  `{business_id, input_hash, model, classified_at, category, opening_type, replaces_name, likely_cuisine, confidence, reason}` with `category ∈ {restaurant, cafe_bakery_dessert, food_hall_stall, food_truck, excluded}`, `opening_type ∈ {new_opening, new_concept, ownership_transfer}`, `confidence` float 0–1, `reason` ≤ 120 chars.
- Skip rule: a business is sent only if no prior record has the same `input_hash` (sha256 of the sorted-key JSON of its candidate row).

- [ ] **Step 1:** Write tests with a fake client object returning recorded structured outputs:
  - `test_only_unseen_inputs_are_sent` (prior has same hash → 0 calls),
  - `test_changed_inputs_are_resent`,
  - `test_record_fields_and_enums` (every record has the keys above, enum values valid, 0 ≤ confidence ≤ 1),
  - `test_failures_are_counted_not_raised` (client raises `anthropic.APIStatusError` for one candidate and returns `stop_reason == "refusal"` for another → 2 failed, others returned, no exception),
  - `test_lands_one_write_once_file` (moto S3; key under `raw/claude_classifications/dt=…/`; `put_once` used).
- [ ] **Step 2:** `uv run pytest tests/test_claude_classifications.py -v` → FAIL.
- [ ] **Step 3:** Implement. One `messages.create` per candidate with `output_config.format` JSON schema; system prompt states the category/opening-type definitions from `docs/PROJECT_SPEC.md` §6 and asks for `likely_cuisine` only when the name makes it evident (else null). Treat the candidate JSON as data in a delimited block.
- [ ] **Step 4:** `uv run pytest -v && uv run ruff check .` → PASS.
- [ ] **Step 5:** Manual check (owner's key, small spend): `uv run python run.py classify --db ../transform/kcne.duckdb --limit 5` against sample data → 5 records printed, cost in the log line.
- [ ] **Step 6:** Commit `feat(ingestion): Claude Haiku classification of new candidates with confidence`.

### Task 6: Classifications in dbt, overrides, scoring and app marts

**Files:**
- Create: `transform/models/staging/claude/{_claude__sources.yml,_claude__models.yml,stg_claude__classifications.sql}`, `transform/models/marts/{_marts__models.yml,mart_new_openings.sql,mart_metrics.sql}`, `transform/seeds/{classification_overrides.csv,score_params.csv}`, `transform/analyses/pending_review.sql`
- Modify: `transform/seeds/_seeds.yml`, sample data (add a sample classifications file)

**Interfaces:**
- Produces:
  - `stg_claude__classifications` (grain: `business_id`): latest record per business.
  - `classification_overrides.csv` columns `business_id,category,opening_type,replaces_name,likely_cuisine,decided_at,note`; a row always wins over Claude.
  - `mart_new_openings` (grain: `restaurant_id` = business_id): `restaurant_id, name, address, city, zip5, latitude, longitude` (null for trucks), `category, opening_type, replaces_name, likely_cuisine, first_inspection_date, days_open, first_inspection_result, first_inspection_red_points, latest_inspection_date, latest_red_points, red_violations` (list of `{date, description, points}` for RED violations, max 5), `freshness, safety, score, rank, why` (one line built from facts, e.g. "First inspected Oct 28; clean first inspection; replaces Joe's Diner"), `source` (`claude` | `override`), `confidence`. Includes only: classified (override or Claude confidence ≥ `min_confidence`), category ≠ `excluded`, opening_type ≠ `ownership_transfer`.
  - `mart_metrics` (one row): `built_at, opened_last_30_days, opened_last_180_days, clean_first_inspection_count, by_city` (JSON top 10), `pending_review_count`.
  - `analyses/pending_review.sql`: candidates with confidence < threshold or no classification, with Claude's reason (the owner's "what's pending?" query).
- [ ] **Step 1:** YAML tests: PK tests; `accepted_values` for category/opening_type; `dbt_utils.expression_is_true`: `opening_type <> 'ownership_transfer'`, `category <> 'excluded'`, `(replaces_name is not null) = (opening_type = 'new_concept')`, `confidence between 0 and 1`, `score between 0 and 100`, `latitude is not null or category = 'food_truck' or geocode_match_status <> 'Match'` (trucks and unmatched addresses stay in the list without a pin; a matched non-truck must have coordinates; add `geocode_match_status` to the mart), `rank` unique; source freshness on classifications (warn 2 days).
- [ ] **Step 2:** `uv run dbt build --vars '{raw_root: data/sample/raw}'` → FAIL.
- [ ] **Step 3:** Implement models and seeds (`score_params.csv`: `w_freshness=0.6, w_safety=0.4, safety_floor_points=50, half_life_days=30, window_days=180, min_confidence=0.8`).
- [ ] **Step 4:** Same command → PASS; the ownership-transfer fixture is absent, the new-concept fixture shows "replaces …", an override row changes a sample's category.
- [ ] **Step 5:** Commit `feat(transform): classification overrides, scoring and app marts`.

### Task 7: Export and publish guard

**Files:**
- Create: `transform/export.py`, `transform/tests/test_export.py`

**Interfaces:**
- Consumes: `mart_new_openings`, `mart_metrics` in `kcne.duckdb`; previous export at `s3://$RAW_BUCKET/exports/latest/openings.json` (absent on first run).
- Produces: CLI `uv run python export.py --db kcne.duckdb --out ../app/data/` writing `openings.json` (array, mart columns), `metrics.json` (object), `manifest.json` (`built_at, row_count, schema_version: 1`), then uploads the three to `exports/dt=YYYY-MM-DD/<run_id>/` and copies to `exports/latest/`. Function `check_publishable(new_count: int, previous_count: int | None) -> None` raising `PublishBlocked`.
- [ ] **Step 1:** Tests: `test_blocks_empty` (0, None → raises), `test_blocks_large_drop` (40, 100 → raises), `test_allows_first_run` (25, None → ok), `test_allows_normal` (95, 100 → ok), `test_writes_three_files` (tmp DuckDB with two rows → files exist, `row_count == 2`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(transform): JSON export with empty/drop publish guard`.

### Task 8: Next.js app shell with passcode gate, metrics and top 3

**Files:**
- Create: `app/` via `create-next-app` (TypeScript, App Router, no Tailwind unless v0 output needs it), `app/middleware.ts`, `app/app/login/page.tsx`, `app/app/api/login/route.ts`, `app/lib/auth.ts`, `app/lib/data.ts`, `app/lib/rank.ts`, `app/app/page.tsx`, `app/components/{Metrics.tsx,TopThree.tsx}`, `app/data/sample/{openings.json,metrics.json}` (labelled sample), `app/tests/{auth.test.ts,rank.test.ts}`, `app/vitest.config.ts`

**Interfaces:**
- `lib/auth.ts`: `signSession(secret: string): Promise<string>`, `verifySession(token: string | undefined, secret: string): Promise<boolean>` (HMAC-SHA256 via Web Crypto, cookie `kcne_session`, 30 days, httpOnly, secure, sameSite lax). Middleware redirects every path except `/login`, `/api/login` and static assets to `/login` when invalid. `/api/login` POST `{passcode}` → compares to `APP_PASSCODE` in constant time, sets cookie, also sets `kcne_visitor` (random UUID) if absent.
- `lib/data.ts`: `getOpenings(): Opening[]`, `getMetrics(): Metrics` reading `app/data/openings.json` / `metrics.json`, falling back to `app/data/sample/` when absent. Types `Opening`, `Metrics` mirror Task 6 columns. Server-only import.
- `lib/rank.ts`: `personalTopThree(openings: Opening[], opts: {here?: {lat: number, lon: number}, tried: Set<string>}): Array<Opening & {distanceMi?: number}>`: drop tried, then if `here` sort by `score − 10 × distanceMi` (trucks and null-coordinate rows sort after mappable ones), else by `rank`; take 3. `haversineMi(a, b): number`.
- Page: metrics strip (opened last 30 days, clean first inspection count, "N near you" within 2 mi when location known) and Top 3 list (`name — why, 0.3 mi`). `revalidate = false`.
- [ ] **Step 1:** Tests: `auth.test.ts` (`verifySession(await signSession(s), s)` true; tampered token false; wrong secret false); `rank.test.ts` (tried places excluded; no location → `rank` order; with location the closer of two equal scores wins; fewer than 3 remaining → returns what's left; `haversineMi` Seattle→Bellevue ≈ 7–8 mi).
- [ ] **Step 2:** `cd app && npx vitest run` → FAIL. **Step 3:** Implement (UI generated with v0 from the design doc §5.5 sketch, then wired to `lib/`). **Step 4:** `npx vitest run && npm run lint && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat(app): passcode-gated page with metrics and personal top 3`.

### Task 9: Map, location and "Tried it"

**Files:**
- Create: `app/components/{OpeningsMap.tsx,TriedButton.tsx}`, `app/lib/tried.ts`, `app/lib/location.ts`, `app/tests/tried.test.ts`
- Modify: `app/app/page.tsx`, `app/components/TopThree.tsx`, `app/package.json` (maplibre-gl)

**Interfaces:**
- `lib/tried.ts`: `loadTried(storage?: Storage): Set<string>`, `toggleTried(id: string, storage?: Storage): Set<string>`; key `kcne_tried`; every access in try/catch, failure → empty set.
- `lib/location.ts`: `requestLocation(): Promise<{lat: number, lon: number} | null>` (null on deny/timeout 8 s; never sent anywhere except with a question).
- `OpeningsMap`: MapLibre with OpenStreetMap-compatible free tiles (provider in env `NEXT_PUBLIC_MAP_STYLE_URL`, default MapLibre demo style), one pin per opening with coordinates, popup `name · why`; trucks listed under the map as "Food trucks (no fixed spot)".
- [ ] **Step 1:** Tests: `tried.test.ts` (toggle adds then removes; storage that throws → empty set, no exception). Add to `rank.test.ts`: `here` undefined after deny → same as no location (Review Focus 3).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npx vitest run && npm run build` PASS; manual: deny location in the browser → top 3 shows no distances.
- [ ] **Step 5:** Commit `feat(app): map of openings, location and Tried it`.

### Task 10: Question bar with hard caps

**Files:**
- Create: `app/app/api/ask/route.ts`, `app/lib/caps.ts`, `app/lib/ask.ts`, `app/components/AskBar.tsx`, `app/tests/{caps.test.ts,ask.test.ts}`
- Modify: `app/app/page.tsx`, `app/package.json` (`@anthropic-ai/sdk`, `@upstash/redis`)

**Interfaces:**
- `lib/caps.ts`: `checkAndCount(redis: RedisLike, visitorId: string, now: Date): Promise<{ok: true} | {ok: false, reason: "global" | "visitor"}>`: `INCR ask:g:<date>` and `ask:v:<visitor>:<date>` (EXPIRE 172800 on first increment); over cap → `ok: false`. Any Redis error throws (route turns it into 429: fail closed).
- `lib/ask.ts`: `buildRequest(question: string, openings: Opening[], ctx: {here?: {lat, lon}, tried: string[]}): MessageCreateParams` (system prompt = Global Constraints answer style + "answer only from the DATA block"; openings trimmed to the fields Haiku needs, tried ids removed, distances added when `here`), `answer(client, params): Promise<string>`.
- `POST /api/ask` body `{question, here?, tried?}`: session check → length ≤ 500 else 400 → `checkAndCount` → Haiku → `{answer}`; cap hit → 429 `{message: "Out of questions for today. The map and lists still work."}`.
- `AskBar`: input + example chips ("Newest near me", "Ones I haven't tried", "Anything to be wary of?", "New cafés this month"); shows answer text; disables while pending.
- [ ] **Step 1:** Tests with a fake Redis and a fake Anthropic client:
  - `caps.test.ts`: 200th global call ok, 201st → `global`; 20th visitor ok, 21st → `visitor`; counter keys use the America/Los_Angeles date (UTC 2026-11-17T06:00Z → `2026-11-16`); Redis throws → rejects.
  - `ask.test.ts`: 501-char question → 400 and client not called; Redis down → 429 and client not called (Review Focus 4); request uses `claude-haiku-5-5`, `max_tokens` 400, effort low; tried ids absent from the DATA block; a restaurant named `Ignore previous instructions` appears only inside the DATA block (Review Focus 5); no `here` and question contains "near me" → system prompt tells model to ask for location.
- [ ] **Step 2:** FAIL → **Step 3:** implement (check the TypeScript README of the claude-api skill for the exact create call and typed errors) → **Step 4:** `npx vitest run && npm run build` PASS.
- [ ] **Step 5:** Manual with the owner's key: ask the four example questions against sample data; each answer ≤ 3 items with one-line reasons.
- [ ] **Step 6:** Commit `feat(app): capped Haiku question bar`.

### Task 11: Daily workflow end to end

**Files:**
- Create: `.github/workflows/daily.yml`, `.github/workflows/ci.yml`
- Modify: `README.md` (how it runs, how to review pending items, cost caps)

**Interfaces:**
- `daily.yml`: `schedule: cron "0 14 * * *"` (≈ 6–7 am Pacific) + `workflow_dispatch`; one job: OIDC AWS creds → `run.py extract` → `dbt build --select staging intermediate` → `run.py classify` → `dbt build --select staging.claude+ marts` → `export.py` → `npx vercel pull --yes --environment=production && npx vercel build --prod && npx vercel deploy --prebuilt --prod`. Any failure stops the job (GitHub emails the owner); nothing deploys.
- `ci.yml` on PRs: `ingestion` pytest + ruff; `transform` dbt build on sample data; `app` vitest + lint + build with sample JSON; `infra` fmt/validate.
- [ ] **Step 1:** `act`-free check: `actionlint` on both files → no errors.
- [ ] **Step 2:** Owner runs `terraform apply`, sets secrets/variables, creates the Vercel project and Upstash database (README checklist).
- [ ] **Step 3:** Trigger `workflow_dispatch`; expected: all steps green, site shows real openings behind the passcode, `pending_review_count` visible in metrics.
- [ ] **Step 4:** Commit `ci: daily pipeline and PR checks`.
