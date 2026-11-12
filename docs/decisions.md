# Decision log

Newest first. One entry per decision: context, decision, consequences.

## 2026-11-12 — Auto-merge small, non-breaking PRs
- **Context:** the owner is often away from the terminal; waiting for a manual merge on small, safe PRs slows the loop.
- **Decision:** Claude may merge its own PR without asking when it is under 200 changed lines, contains no breaking change (as defined in `CLAUDE.md`, "Pull requests and auto-merge") and all required checks pass. Everything else waits for the owner.
- **Consequences:** faster iteration on small changes; spec, scoring, ID-map, guardrail, IAM/cost and destructive infra changes always get a human review. Claude reports every auto-merge.

## 2026-11-12 — KC: current dataset only in milestone 1; legacy deferred
- **Context:** profiling found the legacy dataset (`f29f-zza5`) is private (HTTP 403) and not in the catalog. The current dataset starts January 2021, which is enough history to tell a genuine first inspection from an older business.
- **Decision:** milestone 1 uses only the current dataset. Request the legacy export from Public Health – Seattle & King County for the milestone 6 survival analysis.
- **Consequences:** no legacy union or dedupe in v1; the 2021–2025 overlap problem disappears. If the export never arrives, the survival analysis covers 2021 onward only.

## 2026-11-12 — KC: daily full pull instead of incremental
- **Context:** Socrata `:updated_at` holds one value for all 111,644 rows, so it cannot drive incremental pulls. The dataset is about 3 pages.
- **Decision:** the KC extractor pulls the full dataset every run; dbt dedupes on key.
- **Consequences:** corrections and deletions are always captured; S3 grows by one full copy (a few MB compressed) per day, managed by lifecycle rules. Supersedes the `:updated_at` incremental default for KC.

## 2026-11-12 — Map coordinates from the US Census Geocoder
- **Context:** the current KC dataset has no lat/long, but the v1 app has a map.
- **Decision:** a geocode step in the Step Functions workflow sends only not-yet-geocoded addresses to the free Census batch geocoder and lands results in S3 raw; `int_address_geocodes` joins them in.
- **Consequences:** new source card and staging model; unmatched addresses and food trucks get no pin. Output is public domain, so storing it is fine.

## 2026-11-12 — Exclude stadium, arena and airport-terminal vendors
- **Context:** profiling found large multi-tenant venue addresses (e.g. about 60 units at Lumen Field, SeaTac airport) that diners cannot simply walk into.
- **Decision:** exclude them via `seeds/venue_exclusions.csv` (by address). Food halls and malls stay in as `food_hall_stall`.
- **Consequences:** one more seed to maintain; fewer false "openings" from seasonal concession permits.

## 2026-11-12 — Area filter instead of ZIP filter
- **Context:** a few hundred openings across about 100 King County ZIPs leaves many ZIPs with 0–2 places per list.
- **Decision:** filter by about 15–25 areas (neighborhoods or city groups) from `seeds/zip_to_area.csv` via `dim_zip`. `rank_in_area` replaces `rank_in_zip`. ZIP still shows on cards.
- **Consequences:** lists stay populated when filtered; one more seed to maintain. Food trucks stay out of area rankings.

## 2026-11-12 — Press buzz: name matching with a review queue
- **Context:** headlines rarely carry an address, so press-to-restaurant matching is its own fuzzy problem.
- **Decision:** `int_press_mentions` matches distinctive restaurant names in headlines (rules in `seeds/press_match_rules.csv`); low-confidence hits go to a review queue decided in `seeds/press_mention_overrides.csv`. Only accepted matches count toward buzz.
- **Consequences:** buzz stays a small, auditable weight; generic names (e.g. "Pho House") may get no buzz, which is acceptable.

## 2026-11-12 — Lighter agent loop in milestone 1
- **Context:** the full six-step, eight-agent loop is heavy for the thin slice.
- **Decision:** milestone 1 uses profile → build → data-qa; the full loop (adding spec-reviewer and docs-writer) applies from milestone 2.
- **Consequences:** faster thin slice; spec drift in milestone 1 is caught by the first full review in milestone 2.

## 2026-11-12 — Persisted restaurant ID map
- **Context:** "anchor on the first key observed" is order-dependent; dbt full refreshes and backfills could reassign IDs, and there was no rule for merges or splits.
- **Decision:** `int_restaurant_id_map` is an append-only incremental model with `full_refresh: false`. On a merge the oldest ID survives and the other becomes an alias (`merged_into_id`); splits only via `seeds/entity_overrides.csv`.
- **Consequences:** IDs and detail-page URLs never change. The map is state that must be protected; recovery path is re-seeding from the latest JSON export.

## 2026-11-12 — Step Functions + repository_dispatch; Snowpipe dropped
- **Context:** separate schedules for extract, Snowpipe and dbt could race (dbt on a half-loaded day), and GitHub disables scheduled workflows after 60 days without repo activity.
- **Decision:** EventBridge Scheduler starts a Step Functions workflow that runs the extract Lambdas, then triggers the GitHub dbt workflow via `repository_dispatch`. The workflow loads RAW with `COPY INTO` before `dbt build`. Snowpipe is not used.
- **Consequences:** explicit step ordering and failure handling; no GitHub cron to expire. One fewer Snowflake object type; loading uses the warehouse wake the job already pays for. Supersedes "loaded by Snowpipe" in the S3 entry below.

## 2026-11-12 — Terraform from milestone 1
- **Context:** building milestones 1–3 by hand meant importing or rebuilding resources in milestone 4.
- **Decision:** every resource is Terraform from milestone 1, including the resource monitor and Budgets alert.
- **Consequences:** slower start; no rework later, and cost guardrails exist before the first scheduled run.

## 2026-11-12 — Snowflake budget cap about $10/month
- **Context:** the Snowflake trial ends after about 30 days; after that the daily build, CI and storage are a small real cost.
- **Decision:** resource monitor with a hard monthly credit quota equal to about $10 at the account's credit price; notify at 75%, suspend at 100%.
- **Consequences:** a runaway job or heavy CI month pauses the pipeline instead of spending more; the static site keeps serving the last good build.

## 2026-11-12 — Environments, CI state and incremental pulls (defaults)
- **Context:** CI with `state:modified` needs a stored prod manifest; dev and CI need isolated schemas; date-based lookbacks miss corrections to old records.
- **Decision:** targets `prod`, `dev` (per-developer schema prefix) and `ci` (per-PR prefix, dropped on close); prod `manifest.json` stored at `s3://<bucket>/dbt-artifacts/prod/` and used with `--defer --state`. Incremental pulls filter on Socrata `:updated_at` with a 14-day lookback, plus a weekly full pull to catch deletions. LCB is pulled in full daily if size allows.
- **Consequences:** CI builds only changed models; S3 holds enough history to rebuild LCB status changes from raw.

## 2026-11-12 — What counts as a restaurant and an opening
- **Context:** KC inspections cover every food business (grocery, schools, caterers, events), and both KC and LCB data record ownership changes that look like openings. Without explicit rules the lists would fill with false openings.
- **Decision:** include four categories: `restaurant`, `cafe_bakery_dessert`, `food_hall_stall`, `food_truck`; exclude the rest. Classify each opening as `new_opening`, `new_concept` (different business at a recently occupied address, shown as "replaces X") or `ownership_transfer` (same address, similar name; excluded). Mapping rules, the 12-month window and the name-similarity threshold live in seeds, filled from profiling.
- **Consequences:** new models `int_lcb_notices_classified` and `int_opening_events`. Food trucks appear county-wide with a badge, with no map pin and no ZIP ranking, because their recorded address is usually not where they serve. Multi-tenant addresses require a strong name match.

## 2026-11-12 — History backfill moves to milestone 1
- **Context:** "Just opened" depends on identifying a business's first-ever inspection, which incremental pulls with a 14-day lookback cannot do.
- **Decision:** milestone 1 loads the legacy CSV and one full pull of the current dataset before switching to incremental.
- **Consequences:** milestone 1 grows; milestone 4 no longer carries the backfill job.

## 2026-11-12 — Two separate lists: Just opened and Opening soon
- **Context:** in one combined ranking, LCB-only places could never compete: freshness decayed from the filing date (months before opening) and safety had no value before a first inspection.
- **Decision:** `mart_new_openings` carries a `list` column (`just_opened` | `opening_soon`); each list is scored and ranked separately with its own weights in `seeds/score_weights.csv`. The `stage` component is removed (it is constant within a list). Safety applies only to Just opened. A place moves lists on its first inspection and keeps its `restaurant_id`.
- **Consequences:** scores are comparable only within a list; the app shows two top-5 lists; `rank_in_list` and `rank_in_zip` (within list) replace `rank_overall`.

## 2026-11-12 — Framing: "newest openings, ranked by transparent signals"
- **Context:** there is no ground truth for "worth trying", and the planned survival backtest would validate a different model (no press or LCB history) against an outcome (survival) that is not "worth trying".
- **Decision:** present the ranking as the newest openings ordered by visible signals. Weights are set by judgment and documented; no weight tuning or score backtest.
- **Consequences:** milestone 6 survival analysis remains, as a standalone descriptive study, not score validation.

## 2026-11-12 — Seattle business licenses dropped from v1 *(revisit later)*
- **Context:** the dataset covers only the City of Seattle, so its "+ business license" signal was unreachable for the rest of King County and would bias a county-wide ranking toward Seattle. Licenses are also often filed at a mailing address. Its main use was UBI matching to LCB, which does not reach the inspection data.
- **Decision:** remove the source, `stg_seattle__business_licenses`, its snapshot and the `ubi_exact` match method from v1.
- **Consequences:** entity resolution between LCB and inspections relies on fuzzy name + address plus manual overrides. Revisit if a county-wide license source appears, or as a Seattle-only confidence boost for matching (not for scoring).

## 2026-11-12 — Cuisine removed from v1
- **Context:** no source has a cuisine field; the inspection "description" is a seating/risk category, and name keywords are unreliable.
- **Decision:** no cuisine column in marts or UI in v1.
- **Consequences:** cards show name, neighborhood + ZIP, score and signals. Could return with Google Places (milestone 5) only within its terms.

## 2026-11-12 — App builds from JSON exports in S3, not from Snowflake
- **Context:** reading Snowflake from the Vercel build put warehouse credentials in Vercel, tied every app build (including local and v0 development) to warehouse access, and made builds non-reproducible.
- **Decision:** after a passing `dbt build`, GitHub Actions unloads the app's marts to JSON with Snowflake `COPY INTO` an S3 stage: `exports/dt=YYYY-MM-DD/<run_id>/` (kept) and `exports/latest/` (with `manifest.json`), then calls the Vercel deploy hook. The Vercel build reads `exports/latest/` with a read-only IAM key scoped to that prefix. Local and v0 development use checked-in, labelled sample JSON.
- **Consequences:** no Snowflake service user for the app; Snowflake's storage integration may write only under `exports/` (`raw/` stays immutable); every published build can be traced to a dated export. Supersedes the build-time Snowflake read in the entry below.

## 2026-11-12 — Next.js (v0) on Vercel, reading Snowflake at build time *(data access superseded 2026-11-12 by JSON exports)*
- **Context:** the app should practice prompt-built React apps (Lovable/Vercel). A Supabase/Postgres copy of the marts only to serve a webpage was unnecessary. DuckDB was considered and rejected in favor of keeping Snowflake for the modern-data-stack story.
- **Decision:** keep S3 → Snowpipe → Snowflake → dbt. The UI is generated with v0 as a Next.js app on Vercel. Server code reads `MARTS` with a read-only service user (key-pair auth) at build time; a Vercel deploy hook triggers the rebuild after a passing `dbt build`.
- **Consequences:** no serving database and no per-visitor warehouse queries; about one warehouse wake per day. Supersedes the Evidence decision below.

## 2026-11-06 — No live AI agent in the public app
- **Context:** per-question LLM calls plus warehouse wake-ups scale cost with traffic.
- **Decision:** the public app is static; no AI Q&A. Agents are used to *build* the project.
- **Consequences:** dbt semantic layer (MetricFlow) is optional; metric definitions are documented in model YAML and the spec.

## 2026-11-06 — Evidence (static) for the app *(superseded 2026-11-12)*
- **Context:** need a usable, interactive app without web development or per-visitor cost. Lightdash public embedding requires its paid cloud.
- **Decision:** Evidence open source, built in GitHub Actions, hosted statically.
- **Consequences:** data shipped to the browser must be lean; only `mart_new_openings` (and small dims) are exposed.

## 2026-11-06 — Land raw data in S3 before Snowflake
- **Context:** source portals overwrite records and have changed dataset IDs.
- **Decision:** immutable dated raw files in S3, loaded by Snowpipe *(loading changed 2026-11-12 to `COPY INTO` in the pipeline job)*.
- **Consequences:** full replayability and warehouse portability; one more layer to manage.

## 2026-11-06 — AWS + Snowflake + dbt Core + Terraform; no Airflow in v1
- **Context:** job postings reference the modern data stack; cost must stay near zero.
- **Decision:** EventBridge + Lambda for extraction, GitHub Actions to run dbt, Terraform for infra. Optional local Dagster demo later.

## 2026-11-06 — Google Places stores only place_id
- **Context:** Google terms prohibit caching Places content and building place databases. Yelp's API is no longer free.
- **Decision:** ratings deferred to milestone 5, fetched at build time, only `place_id` stored.

## 2026-11-06 — Differentiate from existing inspection maps
- **Context:** food.snoking.app already maps inspection ratings for King + Snohomish.
- **Decision:** focus on early opening detection, a multi-signal score, survival analysis and visible engineering.
