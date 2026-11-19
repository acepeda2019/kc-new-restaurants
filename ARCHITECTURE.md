# Architecture: King County New Eats

**This is the single, current description of the system.** Review code against it.
If a change alters anything here, update this file in the same PR and add a dated entry
to `docs/decisions.md` saying why.

| Question | Where it lives |
|---|---|
| How does the system work now? | **This file** |
| Why was something chosen? | `docs/decisions.md` (dated log, newest first) |
| How did we get here? (designs, plans) | `docs/superpowers/` (dated, frozen history; not current) |
| What does a source look like? | `docs/source_cards/` |
| How should Claude work in this repo? | `CLAUDE.md` |

Status key: **built** = merged on `main`; **in review** = open PR; **planned** = not built
yet (Linear ticket in brackets).

## 1. What it is

A private web app for the owner and a few friends that answers:
*"What restaurants just opened near me, and why is each worth a look?"*

One screen: a question bar, a map of new openings, three headline numbers, a personal
top 3 with one-line reasons, and a collapsed "All N places" list under the map. UI mockup (private artifact):
https://claude.ai/artifact/DtEGBA9Zv91zrdhsophvgB

**In scope:** "Just opened" restaurants in King County, from KC food inspections, refreshed
daily. Claude makes the judgment calls the data can't. A capped live question bar.

**Later, in this order:** "Opening soon" (WA liquor-license notices); press buzz; ratings
(Google Places: store `place_id` only, per its terms); survival analysis, Snohomish County,
detail pages, accounts.

**Never:** invented facts (no "good"/"best" without ratings data; inferred cuisine is always
"likely X"); opinions about safety (cite inspection records only); any path where traffic
can push cost past the caps.

## 2. System flow

```
GitHub Actions, daily cron + manual run                        .github/workflows/daily.yml
  1. extract   KC inspections, full pull        → s3 raw/kc_inspections/dt=…/<run_id>.jsonl.gz
  2. geocode   new addresses only → Census      → s3 raw/census_geocoder/dt=…/<run_id>/
  3. dbt build staging + intermediate (DuckDB, reads raw from S3)  → candidates
  4. classify  candidates never seen before → Claude Haiku → s3 raw/claude_classifications/…
  5. dbt build marts + tests                    → mart_new_openings, mart_metrics
  6. publish   export JSON → guard (refuse 0 rows or <50% of last run) → s3 exports/dt=…/<run_id>/
               → vercel deploy --prebuilt

Vercel (Next.js)
  proxy       shared passcode → signed cookie; gates every page, the data and the API
  page        JSON baked in at build → map, metrics, top 3 (static)
  /api/ask    caps check (Upstash Redis) → Claude Haiku with the openings JSON as data → short answer
```

Any failed step stops the run: nothing is published and the site keeps the last good data.
The GitHub Actions failure email is the alert.

| Component | Where | Status |
|---|---|---|
| KC + Census extractors | `ingestion/sources/` | built |
| S3 raw bucket + GitHub OIDC role | `infra/` | built (SAN-31), not yet applied; `terraform apply` by owner only |
| CLI runner for the extractors | `ingestion/run.py` | built (SAN-33) |
| dbt staging (KC, Census) | `transform/models/staging/` | built (SAN-34) |
| dbt candidates (`int_establishments`, `int_candidates`) | `transform/models/intermediate/` | built (SAN-34) |
| Claude classification | `ingestion/sources/claude_classifications.py` | built (SAN-35), not yet run live |
| Marts | `transform/models/marts/` | built (SAN-36) |
| Export + publish guard | `transform/export.py` | built (SAN-37) |
| App shell + passcode gate | `app/` | built (SAN-38a) |
| App data + personal top 3 ranking | `app/lib/data.ts`, `app/lib/rank.ts` | built (SAN-38b) |
| Home page | `app/` | built (SAN-38c) |
| Location, "Tried it" | `app/lib/location.ts`, `app/lib/tried.ts`, `app/components/PersonalPicks.tsx` | built (SAN-39a) |
| Map + "All N places" list | `app/` | built (SAN-39b/c) |
| Capped question bar | `app/api/ask` | planned (SAN-40) |
| Daily workflow + CI | `.github/workflows/` | planned (SAN-41) |

## 3. Sources

| Source | Access | Grain | Role |
|---|---|---|---|
| KC food inspections, current (`r878-4sxa`, data.kingcounty.gov) | Socrata API, no key | one row per violation | first inspection = "just opened"; safety |
| US Census Geocoder | free batch API, no key | one row per address | lat/long for map pins (KC has none) |
| Claude classifications (our own output) | Anthropic API | one row per KC business | category, opening type, likely cuisine, confidence |

Quirks (details in the source cards):
- KC is pulled **in full every run** (~111k rows): `:updated_at` is one value for every
  row, so incremental pulls are impossible. dbt dedupes on key.
- The current KC set starts January 2021, enough to tell a genuine first inspection from an
  older business. There is no pre-opening inspection type, so "just opened" means "first
  inspected", which may trail the real opening by weeks.
- Only addresses never geocoded before go to the Census geocoder. Unmatched addresses and
  food trucks get no pin. The geocode key (MD5 of `street_clean|zip5`,
  `ingestion/sources/geocode_key.py`) must be reproduced exactly in dbt.

**Raw storage rule:** `s3://$RAW_BUCKET/raw/<source>/dt=YYYY-MM-DD/<run_id>…`. Files are
write-once (`If-None-Match: *` enforced by bucket policy) and the pipeline role can't
delete them, so every run can be replayed from raw.

## 4. Domain rules

**Included categories** (`category`): `restaurant`, `cafe_bakery_dessert`,
`food_hall_stall`, `food_truck`. Everything else is excluded: grocery and convenience,
institutional kitchens, caterers and commissaries, temporary events, and stadium, arena and
airport-terminal vendors (`seeds/venue_exclusions.csv`, by address).

**Opening types** (`opening_type`):
- `new_opening`: no other food business at the address in the prior 12 months.
- `new_concept`: a different business replaced one at the address within 12 months;
  `replaces_name` holds the old name ("replaces X").
- `ownership_transfer`: same place, new owner or re-issued ID. **Not an opening; excluded.**

**Rules first, Claude for the rest.** Clear cases are deterministic, in seeds and dbt: KC
`classification` → rule category (`seeds/classification_rules.csv`: "Mobile Food Unit" =
`food_truck`; grocery, institutional, caterer and seasonal classes `excluded`; General Food
Services, Bakery and Limited Food Service `needs_judgment`), venue exclusions, the 180-day
window. Claude decides only what rules can't: café vs restaurant vs food-hall stall vs
corporate cafeteria, in-store vs standalone bakery, coffee stands, and the opening type. It gets
the count of businesses at the address and the other businesses there in the prior 12 months.

**Candidates** (`int_candidates`): first inspected within 180 days of the pull, rule category
not `excluded`, not at an excluded venue, and not closed by its latest inspection. A failed
("Unsatisfactory") first inspection does **not** exclude a place; it ranks lower on safety
(owner, 2026-11-17). About 600 candidates on the full data (2026-11-17).

**Claude classification** (`claude-haiku-5-5`, structured output):
- Input: only *candidates*, meaning businesses first inspected in the last 180 days that the
  rules didn't exclude and that were never classified before. That's hundreds on the first
  run, a handful a day after.
- Output: `category`, `opening_type`, `replaces_name`, `likely_cuisine` (nullable),
  `confidence` 0–1, one-line `reason`.
- Confidence ≥ `min_confidence` (seed, 0.8) → used. Below → held out of the app and listed
  in `analyses/pending_review.sql`.
- `seeds/classification_overrides.csv` always wins. The owner reviews pending rows by asking
  Claude Code "what's pending?".
- API errors, refusals or malformed output leave a candidate unclassified (out of the app).
  The run still succeeds, logs the count and retries the candidate next run.

**Food trucks:** the recorded address is a base, not where they serve, so trucks get no pin
and no distance.

## 5. Data model (dbt on DuckDB, `transform/`)

| Model | Grain | Purpose |
|---|---|---|
| `stg_kc__inspection_violations` | violation | rename/cast raw KC rows |
| `stg_kc__inspections` | inspection | violations deduped to inspections |
| `stg_census__geocodes` | geocode key | lat/long + match status |
| `stg_claude__classifications` | KC business | latest Claude classification |
| `int_establishments` | KC business | first/latest inspection, address key, coordinates, rule category, venue flag, businesses at the address |
| `int_candidates` | KC business | rule-filtered businesses inside the 180-day window (input to Claude) |
| `int_classified_candidates` | KC business | each candidate's decision (override wins, else Claude) and `review_status`: accepted, rejected or pending |
| `mart_new_openings` | restaurant | the app table: accepted openings, score, rank, one-line "why it's here", up to 5 red violations |
| `mart_metrics` | one row | opened in the last 30 days (and the 30 before), last 7 days, last 180 days, clean first inspections, top 10 cities, pending-review count |

**Identity:** `restaurant_id` = KC `business_id`. Cross-source identity (an ID map, merges,
splits) waits for "Opening soon".

**Seeds:** `classification_rules.csv`, `venue_exclusions.csv`,
`classification_overrides.csv` (empty until the owner decides a case), `score_params.csv`
(weights, window, `min_confidence`).

**"What's pending?"** `analyses/pending_review.sql` lists candidates with no answer or
confidence below 0.8. An educational first visit (no score) counts as 0 red points, and its
"why" line says it was not scored.

**Tests that enforce the rules:** `unique` + `not_null` on every key, with the grain stated in
the YAML. No `ownership_transfer` or excluded category in `mart_new_openings`.
`replaces_name` is present exactly for `new_concept`. `confidence` is in [0, 1]. Coordinates are
present unless the row is a food truck or its geocode didn't match. Requested geocode keys
match the dbt key. Source freshness.

## 6. Ranking

`score = 100 × (0.6·freshness + 0.4·safety)` with
`freshness = 0.5 ^ (days_since_first_inspection / 30)` and
`safety = greatest(0, 1 − first_inspection_red_points / 50)`. Weights and the 50 live in
`seeds/score_params.csv`. Only places first inspected within 180 days qualify.

This ranks the *newest* openings with a boost for a clean first inspection. It does not
claim food quality.

**Personal top 3:** computed in the browser as `score − 10 × distance_mi`, dropping places
marked "Tried it". Without location it falls back to score order with no distances.
With a location, food trucks and places without coordinates rank after every place that
has a fixed spot (in rank order, highest score first; no distance shown): a truck's address is a base, not
where it serves, so it can't be "near you".

## 7. App (`app/`, Next.js on Vercel)

- **Private:** `app/proxy.ts` (Next.js 16's name for middleware) sends every request
  without a valid `kcne_session` cookie to `/login`. `/api/login` checks one shared
  passcode and sets the cookie (HMAC-signed with `SESSION_SECRET`, 30 days). Missing
  secrets fail closed. The JSON is served only through the app, never from a public URL.
- **Data:** `openings.json` and `metrics.json` (plus `manifest.json`: row count, schema
  version) are baked into each deploy. A dated copy of every published export stays in
  `s3://$RAW_BUCKET/exports/dt=…/<run_id>/` (never overwritten); the guard compares with
  the newest one. Visitors never
  touch S3 or the pipeline. Per restaurant, the JSON carries the first and latest
  inspection result, red points and short red-violation descriptions, so answers can cite
  records.
- **Build checks (`app/lib/data.ts`):** the build fails on a partial export, an unknown
  `schema_version`, a missing or null key column, or a row count that disagrees with the
  manifest. With no export at all it uses the labelled sample in `app/data/sample/`, except
  when `REQUIRE_EXPORT=1` (to be set in the daily workflow's env by SAN-41, never as a
  Vercel env var): then the build fails, the job stops before deploying, and the last good
  deploy stays live.
- **Location:** browser geolocation, asked when the visitor taps "Use my location" (8 s
  browser timeout, not counting the permission prompt), never stored server-side. "Near me"
  is a 2-mile radius (`NEAR_RADIUS_MI` in `app/lib/rank.ts`) of fixed-location places,
  computed in the browser; once located, the "last 7 days" headline number becomes "N near
  you". "In [place]" uses ZIP and city.
- **"Tried it":** browser localStorage only (`kcne_tried`), sent with each question so
  answers can skip those places. Tried places drop out of the top 3; the one just marked
  stays visible (pressed) so a mistaken tap can be undone in place, and a "N hidden as
  tried · Clear" link resets them (N = tried places still listed, other than the one
  just marked).
- **Layout and look:** a dark theme (ground `#0B0E13`, one lime accent `#D4F75A`, Geist)
  following the owner's UI mockup. On screens 1100px and wider the map fills the window and
  everything floats over it in dark panels: header (logo, question-bar slot, "Sample data ·
  not today's list" pill), your top 3 and the lists on the left, the three stat tiles on
  the right, the legend and data source at the bottom. Below 1100px (phones, tablets, small
  laptops) the map takes the top of the screen and one scrolling sheet below holds the
  tiles, top 3 and lists; there, "Tried it" shows a visible "Tried" label.
- **Map:** MapLibre GL with OpenFreeMap's `dark` style (free, no key);
  `NEXT_PUBLIC_MAP_STYLE_URL` overrides it. Every opening with a fixed location is pinned,
  including ones marked "Tried it"; pin logic is in `app/lib/pins.ts`. Pins: top 3 lime,
  numbered 1-3 to match the cards, larger, drawn on top (winning over red) and labelled with
  the name; red points at latest inspection orange with a light ring; other new places light
  grey; you blue. After "Use my location" the map recenters on the visitor. Clicking a
  place's name in the top 3 or "All N places" flies the map to its pin, opens its popup
  (name · why, as text) and highlights the pin and the card; clicking the name again or
  pressing Escape clears it, and clicking a pin highlights its card. On desktop, hovering a
  pin shows its name. The camera pads around the floating panels so pins never land under
  them. Food trucks get no pin and are listed as "Food trucks (no fixed spot)". If the map or
  its style fails to load, a "Map unavailable" note shows on the plain dark ground, names
  are plain text, and the panels still work. A collapsed "All N places" list (closed by
  default; rows render only when opened) gives every opening as text. Once located:
  fixed-location places nearest first (ties by rank), then food trucks and places without
  coordinates in rank order; without a location, rank order. Tried places are tagged, not
  hidden. It is the keyboard and screen-reader route to what the map shows.
  Visitors' browsers fetch tiles from OpenFreeMap, which sees their IP and the area viewed;
  after "Use my location" that area is near the visitor. Coordinates themselves are never
  sent to this app or anyone else.
- **`/api/ask`** (the only Claude call at request time):
  - caps checked *before* calling Claude, in Upstash Redis: 200 questions/day in total and
    20 per visitor (`ask:g:<date>`, `ask:v:<visitor>:<date>`, Pacific date). Questions are
    limited to 500 characters;
  - **fails closed:** if Redis is unreachable or a cap is hit, it returns 429 with a friendly
    message, and the rest of the page keeps working;
  - `claude-haiku-5-5`, thinking disabled, effort low, `max_tokens` 400;
  - restaurant data goes in a delimited block marked as data, and the system prompt says to
    answer only from it (prompt-injection defence). The block holds at most 100 places
    (`MAX_DATA_ROWS`): the nearest once located, else the top-ranked, with tried places
    removed first. Answers are plain text, never rendered as HTML; an answer built from the
    labelled sample ends with "(Answered from sample data, not today's list.)";
  - order in `app/app/api/ask/route.ts`: session → body (question ≤ 500 chars) → visitor
    cookie → API key present → caps (visitor counter, then global; refused questions count)
    → Claude (no SDK retries). A missing API key returns 503 without counting; Redis
    missing or down returns 429. Questions and locations are never logged.
- **Answer style:** at most 3 recommendations, one-line reason each. "Likely <cuisine>" for
  inferred cuisine. "Wary" answers cite the inspection date and red points. Say plainly
  when the data can't answer (hours, price, ratings, opening soon).

## 8. Infrastructure, secrets, cost

- **Terraform** (`infra/`): one private, versioned S3 bucket and one IAM role that only
  GitHub Actions on this repo's `main` can assume (OIDC). The owner runs `terraform apply`.
- **Secrets** only in GitHub Actions secrets and Vercel env vars, never in the repo:
  `ANTHROPIC_API_KEY` (a dedicated key for this app), `APP_PASSCODE`, `SESSION_SECRET`,
  `KV_REST_API_URL`, `KV_REST_API_TOKEN` (set by Vercel's Upstash integration), `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`. AWS is reached via the OIDC role (`AWS_ROLE_ARN` repo variable).
- **Cost:** each question sends at most 100 places (about 15k input tokens) and gets at most
  400 output tokens. At Haiku 5.5's rates ($0.10 / $0.50 per million input / output tokens,
  for prompts up to 100k tokens) that is about $0.0017 per question. With no SDK retries,
  one counted question is at most one billed call, so the 200/day global cap bounds the
  worst case at about $0.35/day. Classification is a few cents per day after the first run. Everything
  else is on free tiers.

## 9. Open questions

- The typical lag between opening and first inspection (affects the "just opened" wording).
- KC rule details: "Bakery", "Limited Food Service", "Nonprofit Institution", seasonal
  `SFE-` IDs.
