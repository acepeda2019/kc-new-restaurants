# Project spec: King County New Eats

Status: draft v0.4 (2026-11-12). Owner: Adrian.
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
  (top 5) and **Opening soon** (top 5), filters by **area** (a neighborhood or city group), sees *why* each
  ranks (signal checklist).
- **Reviewer (secondary):** reads README → architecture diagram → dbt docs
  lineage → app → short video.

Prototype (v0): mobile screen with area filter pills and two ranked lists
(**Just opened**, **Opening soon**). Cards show rank, score, name,
neighborhood + ZIP and a signal checklist. Each list is ranked on its own;
places never compete across lists. Later: Hot vs Sleeper toggle, restaurant
detail page (signal timeline, inspection history), map view.

Cuisine is out of v1 (no reliable source field; see `docs/decisions.md`).

## 3. Scope

**In v1:** King County inspections, WA LCB license notices, press RSS
headlines; daily pipeline; `mart_new_openings`; marts exported to JSON in S3;
Next.js app on Vercel (UI built with v0) with two top-5 lists + area filter +
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
| King County food inspections, current (`r878-4sxa` on data.kingcounty.gov) | Socrata SODA API / CSV export | one row per **violation** (inspections with several violations repeat `Inspection_Serial_Num`) | `business_id`, `inspection_serial_num` (both `PFE-` prefixed), name, address; **no lat/long, UBI or license number** (profiled; see source card) | safety signal; first-inspection = "just opened" |
| King County food inspections, legacy (`f29f-zza5`) | **not public** (HTTP 403); export to be requested from Public Health – Seattle & King County | same, 2006–Nov 2025 | different `business_id` scheme; serials map 1:1 via the `PFE-` prefix | survival analysis only (milestone 6) |
| US Census Geocoder (geocoding.geo.census.gov) | free batch API, no key | one row per geocoded address | normalized address | lat/long for map pins (KC data has none) |
| WA LCB local authority notices (`vgcw-qfjm` on data.wa.gov) | Socrata API / CSV | one row per license-application notice | license number, UBI, trade name, address (*verify*) | "opening soon" early signal (alcohol-serving places only) |
| Press RSS (Eater Seattle, Seattle Met, others TBD) | RSS | one row per article | GUID, title, link, published date | buzz signal; headlines + links only, no article bodies |
| Google Places (milestone 5) | Places API (New), free monthly cap per SKU | n/a | `place_id` only stored | quality signal, fetched at build time for a shortlist |

Known quirks:
- KC republished the inspection dataset under a new ID in May 2026. The
  current set starts January 2021, which is enough history to separate a
  genuine first inspection from an older business (routine inspections run
  1–3 times a year). The legacy set is not public and is needed only for the
  milestone 6 survival analysis. Business IDs were re-keyed at the republish;
  new businesses since 2026-01 get 6-digit IDs, and some of those re-issue an
  existing business (same name and address).
- KC current is pulled **in full daily** (about 111k rows, 3 pages). Socrata
  `:updated_at` holds a single value for every row, so it cannot drive
  incremental pulls; a full pull also catches corrections and deletions. dbt
  dedupes on key.
- KC has no pre-opening inspection type: a new business's first inspection is
  routine (94%) or educational. "Just opened" therefore means "first
  inspected", which may trail the real opening by some weeks.
- Geocoding: only addresses not already geocoded are sent to the Census
  batch geocoder; results land in S3 raw like any source, so the call volume
  stays tiny and scheduled. Unmatched addresses get no map pin.
- LCB notices: pull the full dataset daily if its size allows (*verify*), so
  S3 holds a complete daily state and status history can be rebuilt from raw
  files even if dbt snapshots are lost.
- Google terms prohibit caching Places content beyond 30 days and building a
  place database; only `place_id` may be stored.

## 5. Architecture

```
EventBridge Scheduler (daily) → Step Functions state machine:
  → extract Lambdas in parallel (one per source) → S3 raw (dated, immutable)
  → geocode Lambda: new KC addresses (not yet in raw geocode results) →
    Census batch geocoder → S3 raw
  → on success of all extracts: Lambda sends GitHub repository_dispatch
    (on any failure: alert, no dispatch)
  → GitHub Actions pipeline.yml (triggered by the dispatch, not by cron):
      COPY INTO Snowflake RAW from the S3 stage (idempotent: Snowflake
      skips files it already loaded)
  → dbt build → STAGING → INTERMEDIATE → MARTS
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
Initial load (milestone 1): first full pull of KC current + geocoding of all
its addresses → S3 raw → RAW. Legacy KC is loaded in milestone 6 if the
export is obtained.
Ops: dbt tests + source freshness, failure alerts, CloudWatch logs,
     secrets in GitHub/Secrets Manager, Terraform state in S3, CI on PRs.
```

Why this orchestration: each step starts only after the previous one
succeeded, so dbt never runs on a half-loaded day. Snowpipe is not used:
loading is one `COPY INTO` per run inside the job that already wakes the
warehouse. No GitHub cron schedule is involved, so GitHub's 60-day inactivity
shutoff of scheduled workflows does not apply. A manual `workflow_dispatch`
trigger allows reruns.

### Environments and CI
- **Targets:** `prod` (schemas `RAW/STAGING/INTERMEDIATE/MARTS`), `dev`
  (one schema prefix per developer, e.g. `DEV_ADRIAN_*`), `ci` (one schema
  prefix per pull request, dropped when the PR closes).
- **State:** after each successful prod run, `manifest.json` is uploaded to
  `s3://<bucket>/dbt-artifacts/prod/`. CI downloads it and runs
  `dbt build --select state:modified+ --defer --state <dir>`, so unchanged
  upstream models are read from prod instead of rebuilt.
- **Terraform:** used from milestone 1 for every resource; CI runs
  `terraform fmt -check` and `plan` on PRs; `apply` only by the owner.

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

### What counts as a restaurant and an opening
Rules live in seeds (values are filled in from profiling, never guessed) and
are applied in intermediate models, not staging.

**Included categories** (`category` column):
- `restaurant` – full- and counter-service restaurants; bars that serve food
- `cafe_bakery_dessert` – coffee, bakeries, ice cream, bubble tea, desserts
- `food_hall_stall` – vendors sharing one street address with other vendors
- `food_truck` – mobile units

**Excluded:** grocery and convenience stores, institutional kitchens (schools,
hospitals, care facilities, corrections), caterers and commissaries without a
public storefront, temporary event permits, **stadium/arena concessions and
airport-terminal vendors** (listed in `seeds/venue_exclusions.csv` by
address), and anything else not listed above.

From profiling (see `docs/source_cards/kc_inspections_current.md`): KC's
`classification` field drives the mapping. "General Food Services" is the
main restaurant pool and "Mobile Food Unit" is `food_truck`. No field marks
cafes or food halls: `cafe_bakery_dessert` comes from name keywords within
the restaurant-class pool, and `food_hall_stall` from `is_multi_tenant`.
"Bakery" (mostly in-store grocery bakeries) and "Limited Food Service"
(mostly espresso stands) need explicit seed rules.
KC inspection type/description fields map to a category via
`seeds/establishment_type_rules.csv`; LCB license types via
`seeds/lcb_notice_type_rules.csv`.

**Opening types** (`opening_type` column):
- `new_opening` – no other food business inspected at the address in the prior
  12 months.
- `new_concept` – a different business at an address that had another food
  business in the prior 12 months, and the names are not similar. Counts as an
  opening; `replaces_name` holds the previous business's name ("replaces X").
- `ownership_transfer` – a new business ID or LCB assumption at the same
  address with a similar name, including a re-issued KC ID that is
  concurrently active with another ID of the same name and address.
  **Not an opening; excluded.**

On the LCB side, only new-application notices for included license types are
candidate openings. Assumptions (ownership changes) are transfers; added
privileges, endorsements and other changes are not openings. Exact notice
types come from profiling. The 12-month window and the name-similarity
threshold are seed parameters.

**Food trucks:** the recorded address is a commissary or base, not a
serving location (confirmed in profiling: many units share commissary
addresses). Trucks appear in the
county-wide lists with a "Food truck" badge, get no map pin and are left out of
area-filtered rankings (`rank_in_area` is null).

**Multi-tenant addresses** (food halls, markets, malls): an
address with several concurrently active businesses is flagged
`is_multi_tenant`. Matching there never relies on address alone; it requires a
strong name match.

### Staging (1:1 with sources)
- `stg_kc__inspection_violations` (grain: violation)
- `stg_kc__inspections` (grain: inspection; deduped from violations)
- `stg_lcb__license_notices` (grain: notice)
- `stg_press__articles` (grain: article)

### Snapshots (SCD2)
- LCB notices, to capture status changes over time.

### Intermediate
- `int_addresses_normalized` – standard street suffixes, unit stripping, ZIP5
- `int_address_geocodes` – one row per normalized address: lat/long and match
  quality from the Census geocoder (null when unmatched)
- `int_kc_establishments` – one row per KC business, first/last inspection
  dates, `category` (or excluded), `is_multi_tenant`
- `int_lcb_notices_classified` – one row per LCB notice: `category`, notice
  class (`new_application` | `assumption` | `other_change`)
- `int_opening_events` – one row per candidate opening: `opening_type`,
  `replaces_name`; excludes `ownership_transfer` and excluded categories
- `int_entity_candidates` – candidate pairs, blocked on ZIP5 + street number
- `int_entity_matches` – pair, method (`fuzzy_name_address` | `override`),
  score, decision; applies `seeds/entity_overrides.csv`. (UBI exists only in
  LCB among v1 sources, so there is no deterministic cross-source key.)
- `int_restaurant_id_map` – persisted, append-only ID registry (incremental,
  `full_refresh: false`): `restaurant_id`, `created_at`, `merged_into_id`
- `int_restaurant_xref` – `restaurant_id` ↔ (`source`, `source_key`)
- `int_restaurant_events` – union of all events: `restaurant_id`,
  `event_type`, `event_date`, `source`, `source_key`, attributes
- `int_press_mentions` – one row per (article, restaurant) match: method
  (`name_exact` | `name_near` | `override`), confidence, decision. Matches
  restaurant names found in headlines; only names distinctive enough to be
  safe (rules in `seeds/press_match_rules.csv`, e.g. minimum length, not a
  common word). Low-confidence hits are written out as a review queue and
  decided in `seeds/press_mention_overrides.csv`; only accepted matches count.
- `int_restaurant_score_components` – `list`, freshness, safety (null for
  Opening soon), buzz (each 0–1)

### Marts
- `dim_restaurant` – golden record (grain: restaurant), SCD2 on name/status
- `dim_zip` – ZIP → `area` (about 15–25 filter areas, e.g. Capitol Hill,
  Ballard, Bellevue, South King) and city; seed-backed
  (`seeds/zip_to_area.csv`). A ZIP spanning several areas is assigned to one.
- `fct_inspections`, `fct_violations`
- `fct_restaurant_events` – the event log
The app receives only `mart_new_openings`, `dim_zip` and
`fct_restaurant_events` (detail-page timeline, filtered to restaurants in
`mart_new_openings`), as JSON exports with explicit column lists.

- `mart_new_openings` – **the app's main table.** Grain: one row per
  restaurant currently "new or upcoming". Columns: ids, name, address, ZIP,
  neighborhood, `category`, `opening_type`, `replaces_name`,
  `latitude`, `longitude` (null for food trucks and unmatched addresses),
  `list` (`just_opened` | `opening_soon`), list-entry date
  (first inspection date or LCB notice date), signal flags, each score
  component, score, `area`, `rank_in_list`, `rank_in_area` (within list).

### Identity rules
- `restaurant_id` is issued once and never changes. It lives in
  `int_restaurant_id_map`, an incremental model that only appends and is
  protected from full refresh (`full_refresh: false`). A new cluster of
  matched source keys with no existing ID gets a new one.
- **Merge:** when matching joins two clusters that already have IDs, the
  oldest ID (`created_at`, then lowest ID) survives; the other gets
  `merged_into_id` set and stays as an alias, so old detail-page URLs can
  redirect.
- **Split:** only through `seeds/entity_overrides.csv` (an explicit "not the
  same" decision); the split-off keys get a new ID.
- A place that appears LCB-only, then gets its first inspection, keeps the
  same `restaurant_id`. This is the primary entity-resolution test case,
  along with merge and split fixtures.
- Recovery: if the ID map is ever lost, it can be re-seeded from the latest
  JSON export in S3 (which carries `restaurant_id` + source keys).
- Match decisions are auditable: keep scores and methods; manual overrides live
  in a seed.

### Required tests
- `unique` + `not_null` on every model's primary key; grain stated in YAML.
- Every event joins to a restaurant; every mart row's ZIP exists in `dim_zip`.
- Score components between 0 and 1; score between 0 and 100;
  `rank_in_list` unique within list; `rank_in_area` unique within (list, area)
  and null exactly for food trucks.
- No mart row has `opening_type = 'ownership_transfer'` or an excluded
  category; `replaces_name` is not null exactly when
  `opening_type = 'new_concept'`.
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
| Buzz | `least(1, ln(1 + recent_press_mentions))`, counting only accepted matches from `int_press_mentions` | both |

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
   The KC extractor does a full pull every run (the current dataset's
   history from 2021 is enough to identify first inspections); addresses are
   geocoded with the Census batch geocoder. All infrastructure is
   Terraform from the start, including the resource monitor and AWS Budgets
   alert.
2. **Openings signals:** LCB notices, entity resolution, event log,
   `mart_new_openings`, tests, CI on PRs.
3. **App v1:** two top-5 lists + area filter, signal checklist, dbt docs site,
   README + architecture diagram.
4. **Hardening:** failure alerting end to end, export/ID-map recovery drill,
   press RSS buzz signal.
5. **Quality layer:** Google Places for a shortlist at build time, Bayesian-
   adjusted rating, Hot/Sleeper modes.
6. **Analysis:** opening survival analysis (needs the legacy KC export,
   requested from Public Health), write-up/blog post, 2–3 minute video.

## 9. Cost guardrails

- Snowflake: XS warehouse, 60 s auto-suspend, resource monitor with a hard
  monthly credit quota equal to **about $10/month** at the account's credit
  price (Terraform variable), notify at 75%, suspend at 100%. When suspended,
  pipeline runs fail and the site keeps serving the last good build. Budget
  this as a real cost after the trial ends.
- AWS: Budgets alert; Lambda, Step Functions and S3 stay in free-tier-scale
  usage.
- App is static; zero marginal cost per visitor. Snowflake wakes once per
  pipeline run (dbt build + JSON export, about one wake per day); the Vercel
  build reads S3 only.
- Google Places (later): build-time only, quota capped below the free tier.

## 10. Open questions

- Which keys actually exist in each source (UBI and license number in LCB?).
- Opening soon freshness: a newer filing is further from opening. Should the
  list favor recent filings (current rule) or filings nearing the typical
  filing-to-opening lag? Revisit after profiling the lag.
- Actual refresh cadence of LCB and press (KC: data current to the day;
  daily vs weekly publication not yet confirmed).
- Which LCB notice types mean a new application vs an assumption (fills the
  LCB classification seed). KC classification values are profiled.
- KC seed decisions: how to treat "Bakery", "Limited Food Service",
  "Nonprofit Institution" and seasonal `SFE-` IDs; the cafe name-keyword list.
- Typical lag between opening and first KC inspection (affects how "Just
  opened" is worded in the UI).
- Which press feeds are available and stable.
- Map tiles: OpenStreetMap tiles (usage policy, fine at low traffic) vs a free-tier provider for MapLibre.
