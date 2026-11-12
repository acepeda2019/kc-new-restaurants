# Decision log

Newest first. One entry per decision: context, decision, consequences.

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
- **Decision:** immutable dated raw files in S3, loaded by Snowpipe.
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
