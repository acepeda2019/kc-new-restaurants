# Project spec: King County New Eats

Status: draft v0.2 (2026-11-12). Owner: Adrian.
Changes to this file need the owner's OK and an entry in `docs/decisions.md`.

## 1. Goal

**User question:** *What are the new and upcoming restaurants I should try in
King County, and which ones near me?*

**Portfolio goal:** demonstrate analytics-engineering work end to end, in a form
a reviewer can understand in minutes: governed models, entity resolution,
tests, CI, infrastructure as code, cost control, and a usable app.

**Positioning.** Inspection-safety maps already exist (for example
food.snoking.app covers King + Snohomish with cuisine-normalized ratings). This
project does not compete on safety maps. It adds:
1. Early detection of openings, before they appear in inspection data
   (liquor-license filings arrive ~90 days before opening).
2. The newest openings, ranked by transparent signals (every rank is
   explained by a visible signal checklist; no claim of predicting quality).
3. Opening survival analysis on 20 years of inspection history (later).
4. Visible engineering: lineage, tests, CI, documented decisions.

## 2. Users and the app

- **Diner (primary):** opens the app and sees **two lists**: **Just opened**
  (top 5) and **Opening soon** (top 5), filters by **ZIP**, sees *why* each
  ranks (signal checklist).
- **Reviewer (secondary):** reads README → architecture diagram → dbt docs
  lineage → app → short video.

Prototype (v0): mobile screen with ZIP filter pills and two ranked lists
(**Just opened**, **Opening soon**). Cards show rank, score, name,
neighborhood + ZIP and a signal checklist. Each list is ranked on its own;
places never compete across lists. Later: Hot vs Sleeper toggle, restaurant
detail page (signal timeline, inspection history), map view.

Cuisine is out of v1 (no reliable source field; see `docs/decisions.md`).

## 3. Scope

**In v1:** King County inspections, WA LCB license notices, press RSS
headlines; daily pipeline; `mart_new_openings`; marts exported to JSON in S3;
Next.js app on Vercel (UI built with v0) with two top-5 lists + ZIP filter +
map and restaurant detail pages; dbt docs site; README with architecture
diagram.

**Out of v1 (maybe later):** Seattle business licenses (Seattle-only coverage
biases a county-wide ranking; revisit as a signal later), cuisine, Google
Places ratings (milestone 5), Snohomish County, survival analysis
(milestone 6), any live AI/LLM feature in the public
app (rejected on cost grounds), Airflow/Dagster (a local Dagster demo is
optional at the end), streaming.

## 4. Sources

Everything below marked *verify* must be confirmed during profiling and recorded
in `docs/source_cards/`.

| Source | Access | Raw grain | Keys (expected) | Role |
|---|---|---|---|---|
| King County food inspections, current (`r878-4sxa` on data.kingcounty.gov) | Socrata SODA API / CSV export | one row per **violation** (inspections with several violations repeat `Inspection_Serial_Num`) | business ID, inspection serial number, name, address, lat/long (*verify names*) | safety signal; first-inspection = "just opened" |
| King County food inspections, legacy (`f29f-zza5`) | CSV | same, 2006–Nov 2025 | same (*verify schema differences*) | backfill + survival analysis |
| WA LCB local authority notices (`vgcw-qfjm` on data.wa.gov) | Socrata API / CSV | one row per license-application notice | license number, UBI, trade name, address (*verify*) | "opening soon" early signal (alcohol-serving places only) |
| Press RSS (Eater Seattle, Seattle Met, others TBD) | RSS | one row per article | GUID, title, link, published date | buzz signal; headlines + links only, no article bodies |
| Google Places (milestone 5) | Places API (New), free monthly cap per SKU | n/a | `place_id` only stored | quality signal, fetched at build time for a shortlist |

Known quirks:
- KC republished the inspection dataset under a new ID in May 2026; the legacy
  set stopped at Nov 2025. Union both and dedupe the 2021–2025 overlap.
- Inspection records can arrive late or be corrected: incremental pulls use a
  14-day lookback and merge on key.
- Google terms prohibit caching Places content beyond 30 days and building a
  place database; only `place_id` may be stored.

## 5. Architecture

```
EventBridge (daily cron) → Lambda (one per source) → S3 raw (dated, immutable)
  → Snowpipe → Snowflake RAW
  → GitHub Actions: dbt build → STAGING → INTERMEDIATE → MARTS
  → GitHub Actions (only if dbt build passed): export app marts to JSON
      (Snowflake COPY INTO an S3 stage)
      s3://<bucket>/exports/dt=YYYY-MM-DD/<run_id>/*.json, then copy to
      s3://<bucket>/exports/latest/ (plus manifest.json: built_at, row counts,
      schema version)
  → GitHub Actions: call Vercel deploy hook
  → Vercel builds Next.js: reads exports/latest/*.json → static pages
  → GitHub Actions: dbt docs generate → GitHub Pages
Visitors hit static pages on Vercel's CDN and never touch Snowflake or S3.
The Vercel build never connects to Snowflake.
One-time backfill: legacy KC CSV → S3 raw → RAW.
Ops: dbt tests + source freshness, failure alerts, CloudWatch logs,
     secrets in GitHub/Secrets Manager, Terraform state in S3, CI on PRs.
```

Why S3 first: replayable raw history the portals don't keep (sources overwrite
records and even change dataset IDs) and warehouse portability.

Why JSON exports: the app builds from files, not from the warehouse. No
Snowflake credentials in Vercel, reproducible builds (each dated export is
kept), and local/v0 development runs on checked-in sample JSON
(`app/data/sample/`, labelled as sample data) with no credentials.
Vercel's build reads S3 with a read-only IAM key scoped to `exports/latest/*`.
The `raw/` prefix stays immutable; Snowflake may write only under `exports/`.

## 6. Data model

**Core idea:** a restaurant golden record plus an event log. Every source
contributes events (license filed, inspection, press mention, closure) to a
matched restaurant.

### Staging (1:1 with sources)
- `stg_kc__inspection_violations` (grain: violation)
- `stg_kc__inspections` (grain: inspection; deduped from violations)
- `stg_lcb__license_notices` (grain: notice)
- `stg_press__articles` (grain: article)

### Snapshots (SCD2)
- LCB notices, to capture status changes over time.

### Intermediate
- `int_addresses_normalized` – standard street suffixes, unit stripping, ZIP5
- `int_kc_establishments` – one row per KC business, first/last inspection dates
- `int_entity_candidates` – candidate pairs, blocked on ZIP5 + street number
- `int_entity_matches` – pair, method (`fuzzy_name_address` | `override`),
  score, decision; applies `seeds/entity_overrides.csv`. (UBI exists only in
  LCB among v1 sources, so there is no deterministic cross-source key.)
- `int_restaurant_xref` – `restaurant_id` ↔ (`source`, `source_key`)
- `int_restaurant_events` – union of all events: `restaurant_id`,
  `event_type`, `event_date`, `source`, `source_key`, attributes
- `int_restaurant_score_components` – `list`, freshness, safety (null for
  Opening soon), buzz (each 0–1)

### Marts
- `dim_restaurant` – golden record (grain: restaurant), SCD2 on name/status
- `dim_zip` – ZIP → neighborhood/city (seed-backed)
- `fct_inspections`, `fct_violations`
- `fct_restaurant_events` – the event log
The app receives only `mart_new_openings`, `dim_zip` and
`fct_restaurant_events` (detail-page timeline, filtered to restaurants in
`mart_new_openings`), as JSON exports with explicit column lists.

- `mart_new_openings` – **the app's main table.** Grain: one row per
  restaurant currently "new or upcoming". Columns: ids, name, address, ZIP,
  neighborhood, `list` (`just_opened` | `opening_soon`), list-entry date
  (first inspection date or LCB notice date), signal flags, each score
  component, score, `rank_in_list`, `rank_in_zip` (within list).

### Identity rules
- `restaurant_id` must be stable across daily reruns. Anchor it on the first
  source key observed (often the LCB license) and attach later sources via the
  crosswalk. A place that appears LCB-only, then gets its first inspection,
  keeps the same `restaurant_id`. This is the primary entity-resolution test case.
- Match decisions are auditable: keep scores and methods; manual overrides live
  in a seed.

### Required tests
- `unique` + `not_null` on every model's primary key; grain stated in YAML.
- Every event joins to a restaurant; every mart row's ZIP exists in `dim_zip`.
- Score components between 0 and 1; score between 0 and 100;
  `rank_in_list` unique within list; `rank_in_zip` unique within (list, ZIP).
- Each restaurant appears in at most one list; `safety` is null exactly when
  `list = 'opening_soon'`.
- Export check: row counts in `exports/latest/manifest.json` equal the mart
  row counts for the run.
- Source freshness on every source.

## 7. Scoring (v1)

Purpose: show the **newest openings, ranked by transparent signals**. This is
not a prediction of food quality or of what is "worth trying" (no ratings in
v1, no ground truth). Weights are set by judgment, documented in the seed and
explained in the UI by the signal checklist.

**Two lists, ranked separately.** A restaurant is in exactly one:
- **Just opened:** has a first KC inspection within the last 180 days.
- **Opening soon:** has an LCB notice within the last 180 days and no KC
  inspection yet. Moves to Just opened (same `restaurant_id`) on its first
  inspection.

| Component | Definition (initial) | Lists |
|---|---|---|
| Freshness | `0.5 ^ (days_since_list_entry / 30)`; list entry = first inspection date (Just opened) or LCB notice date (Opening soon) | both |
| Safety | 1.0 for satisfactory first inspection with 0 critical points, scaled down by critical points | Just opened only |
| Buzz | `least(1, ln(1 + recent_press_mentions))` | both |

Initial weights (per list, in `seeds/score_weights.csv`, keyed by `list`):
- Just opened: `score = 100 × (0.50·freshness + 0.30·safety + 0.20·buzz)`
- Opening soon: `score = 100 × (0.70·freshness + 0.30·buzz)`

Weights within a list sum to 1. Scores are comparable only within a list.

Hard filters: exclude closed, unsatisfactory/closed-by-inspection, and places
whose list-entry date is older than 180 days.

Later modes: **Hot** vs **Sleeper** (Sleeper must keep weights non-negative,
e.g. use `1 − buzz` as a component, so the score stays in 0–100). Rank matters
more than the number; the UI shows rank first.

**No weight tuning.** Without ground truth there is no backtest of the score.
The survival analysis (milestone 6) stays as a standalone descriptive study of
openings, not as score validation.

## 8. Milestones

1. **Thin slice:** KC inspections only, end to end (extract → S3 → Snowflake →
   staging → simple mart → one Next.js page on Vercel), deployed on a schedule.
2. **Openings signals:** LCB notices, entity resolution, event log,
   `mart_new_openings`, tests, CI on PRs.
3. **App v1:** two top-5 lists + ZIP filter, signal checklist, dbt docs site,
   README + architecture diagram.
4. **Hardening:** Terraform for everything, alerts, resource monitors, backfill
   job, press RSS buzz signal.
5. **Quality layer:** Google Places for a shortlist at build time, Bayesian-
   adjusted rating, Hot/Sleeper modes.
6. **Analysis:** opening survival analysis, write-up/blog post, 2–3 minute
   video.

## 9. Cost guardrails

- Snowflake: XS warehouse, 60 s auto-suspend, resource monitor with a hard quota.
- AWS: Budgets alert; Lambda and S3 stay in free-tier-scale usage.
- App is static; zero marginal cost per visitor. Snowflake wakes once per
  pipeline run (dbt build + JSON export, about one wake per day); the Vercel
  build reads S3 only.
- Google Places (later): build-time only, quota capped below the free tier.

## 10. Open questions

- Which keys actually exist in each source (UBI and license number in LCB?).
- Opening soon freshness: a newer filing is further from opening. Should the
  list favor recent filings (current rule) or filings nearing the typical
  filing-to-opening lag? Revisit after profiling the lag.
- Actual refresh cadence of each source (to set freshness thresholds).
- Which press feeds are available and stable.
- Map tiles: OpenStreetMap tiles (usage policy, fine at low traffic) vs a free-tier provider for MapLibre.
