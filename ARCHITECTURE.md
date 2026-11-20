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

One screen that is the question bar: a map of new openings behind it, a **"Today" brief**
under it before the first question (two or three plain sentences about what's new, with
tappable place names and question chips that follow from them), and Claude's answer cards
after a question. There are no browse lists; everything else is found by asking or on the map. UI mockup (private artifact):
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
  2b. lcb     WSLCB licence-notice window (Opening soon; may fail without stopping the job)
              → s3 raw/lcb_local_authority/dt=…/<run_id>.jsonl.gz, then its new King County
              addresses → Census geocoder (same key rule and cache as KC)
  3. dbt build up to int_candidates (DuckDB, reads raw from S3)    → candidates
  4. classify  candidates never seen before → Claude Haiku → s3 raw/claude_classifications/…
  5. dbt build everything + tests              → mart_new_openings, mart_metrics
  6. publish   export JSON (incl. opening_soon.json, may be empty) → guard on Just opened (refuse 0 rows or <50% of last run) → s3 exports/dt=…/<run_id>/
               → vercel build (REQUIRE_EXPORT=1) → check /api/ask ships the real export
               → vercel deploy --prebuilt --prod. Any failed step stops the job; nothing deploys.
  Vercel's own deploy-on-push is off for main (app/vercel.json); PRs still get previews.
  ci.yml runs ingestion, dbt-on-sample and app checks on every PR.

Vercel (Next.js)
  proxy       shared passcode → signed cookie; gates every page, the data and the API
  page        JSON baked in at build → map, Today brief (static)
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
| App data, ranking and Today brief | `app/lib/data.ts`, `app/lib/rank.ts`, `app/lib/brief.ts` | built (SAN-38b) |
| Home page | `app/` | built (SAN-38c) |
| Location, "Tried it" | `app/lib/location.ts`, `app/lib/tried.ts`, `app/components/PersonalPicks.tsx` | built (SAN-39a) |
| Map | `app/` | built (SAN-39b/c) |
| Capped question bar | `app/api/ask`, `app/components/AskBar.tsx` | built (SAN-40) |
| Daily workflow + CI | `.github/workflows/` | built (SAN-41); live since 2026-11-19 (first classification run: 637 places, $0.13) |
| Opening soon: LCB snapshot, staging and rules | `ingestion/sources/lcb_local_authority.py`, `transform/models/staging/lcb/`, `int_opening_soon_candidates` | built (SAN-44, SAN-46, SAN-47 rule matching, SAN-48 `mart_opening_soon` + export, schema v2, SAN-50 geocoded, SAN-49 app panel, pins, question bar) |

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

**Today brief** (`app/lib/brief.ts`: `briefFacts` picks the facts, `todayBrief` words them with
a template in the browser). Once per daily build, Claude words the same facts instead
(`app/lib/aiBrief.ts`, only when the build sets `WRITE_AI_BRIEF=1`, which only `daily.yml` does:
one Haiku call, `max_tokens` 300, places named only as `{{id}}` tokens checked against the facts;
anything off falls back to the template and never blocks the deploy). The page labels it
"✦ AI summary", or "✦ Today" for the template, which also takes over once the visitor is
located (it knows what's near them). The facts: how many were first inspected this week (or "N within 2 mi of you" once located) and this
month; the two best-ranked openings of the last 30 days by name (with "likely <cuisine>");
how many recent openings were Unsatisfactory at their latest inspection; and the newest Opening
soon place. Up to four chips ask about what it raised (trucks, things to be wary of, opening soon,
near me). Named places with a pin are buttons that fly the map there.

## 7. App (`app/`, Next.js on Vercel)

- **Private:** `app/proxy.ts` (Next.js 16's name for middleware) sends every request
  without a valid `kcne_session` cookie to `/login`. `/api/login` checks one shared
  passcode and sets the cookie (HMAC-signed with `SESSION_SECRET`, 30 days). Missing
  secrets fail closed. The JSON is served only through the app, never from a public URL.
  The only other public paths are the link-preview image and icons (`/opengraph-image`,
  `/icon.svg`, `/apple-icon`, drawn at build time from `app/opengraph-image.tsx`,
  `app/icon.svg`, `app/apple-icon.tsx`): brand only, never restaurant data. Link previews
  can't pass the passcode, so they read the Open Graph tags (root layout) on `/login`.
- **Data:** `openings.json`, `metrics.json` and `opening_soon.json` (plus `manifest.json`:
  row count, Opening soon count, schema version 2) are baked into each deploy. A dated copy of every published export stays in
  `s3://$RAW_BUCKET/exports/dt=…/<run_id>/` (never overwritten); the guard compares with
  the newest one. Visitors never
  touch S3 or the pipeline. Per restaurant, the JSON carries the first and latest
  inspection result, the county's score for each (red + blue points, as shown on the county's
  site; `*_inspection_score`), red points (red only) and short red-violation descriptions, so
  answers can cite records.
- **Build checks (`app/lib/data.ts`):** the build fails on a partial export, an unknown
  `schema_version`, a missing or null key column, or a row count that disagrees with the
  manifest. With no export at all it uses the labelled sample in `app/data/sample/`, except
  when `REQUIRE_EXPORT=1` (to be set in the daily workflow's env by SAN-41, never as a
  Vercel env var): then the build fails, the job stops before deploying, and the last good
  deploy stays live.
- **Location:** browser geolocation, asked when the visitor taps the pin button in the question bar (8 s
  browser timeout, not counting the permission prompt), never stored server-side. "Near me"
  is a 2-mile radius (`NEAR_RADIUS_MI` in `app/lib/rank.ts`) of fixed-location places,
  computed in the browser; once located, the brief's summary leads with "N new places within
  2 mi of you". "In [place]" uses ZIP and city.
- **"Tried it":** browser localStorage only (`kcne_tried`), sent with each question so
  answers can skip those places. Tried places drop out of the brief; the one just marked
  stays visible (pressed) so a mistaken tap can be undone in place, and a "N hidden as
  tried · Clear" link resets them (N = tried places still listed, other than the one
  just marked).
- **Layout and look:** a dark theme (ground `#0B0E13`, one lime accent `#D4F75A`, Geist)
  following the owner's UI mockup. On screens 1100px and wider the map fills the window and
  everything floats over it in dark panels: header (logo and the "Sample data ·
  not today's list" pill), an ⓘ button beside the logo that opens the About panel
  (`app/components/AboutButton.tsx`, a native `<dialog>`: what the site is, the data sources,
  how to use it, the daily question cap, a GitHub link and a not-affiliated note), the question bar centred at the top with the brief or answer under it, the legend and data source at the bottom.
  The brief sits in a gradient-bordered panel (lime to lavender) labelled "✦ Today". Below 1100px (phones, tablets, small
  laptops) the map takes the top of the screen and one scrolling sheet below holds the
  question bar and the brief or answer; there, "Tried it" shows a visible "Tried" label.
- **Map:** MapLibre GL with OpenFreeMap's `dark` style (free, no key);
  `NEXT_PUBLIC_MAP_STYLE_URL` overrides it. Every opening with a fixed location is pinned,
  including ones marked "Tried it"; pin logic is in `app/lib/pins.ts`. Pins: the cards' open places lime,
  numbered to match the cards (brief or answer), larger, drawn on top (winning over red) and labelled with
  the name; places whose latest inspection the county rated Unsatisfactory orange with a light
  ring (the county's verdict on that visit, not any red points; owner, 2026-11-20); other new places light
  grey; you blue. After "Use my location" the map recenters on the visitor. A "reset view" button (top-right on desktop, bottom-right of the map on phones) returns to
  every pin, or to the visitor once located, and closes any popup (`homeView`). Clicking a
  place's name on a card or in the brief flies the map to its pin, opens its popup
  (name · street, city · latest inspection, as text; hover shows name · city) and highlights the pin and the card; clicking the name again or
  pressing Escape clears it, and clicking a pin highlights its card. A tap counts for the nearest pin within 22px
  (`nearestPin`, `TAP_RADIUS_PX`), so small pins work with a finger. On desktop, hovering a
  pin shows its name. The camera pads around the floating panels so pins never land under
  them. Food trucks get no pin; they come up by asking. If the map or
  its style fails to load, a "Map unavailable. The question bar still works." note shows on the plain dark ground, names
  are plain text, and the question bar still works. The question bar is the keyboard and
  screen-reader route to what the map shows.
  Visitors' browsers fetch tiles from OpenFreeMap, which sees their IP and the area viewed;
  after "Use my location" that area is near the visitor. Coordinates themselves are never
  sent to this app or anyone else.
- **Opening soon:** King County restaurant licence applications not yet inspected
  (`opening_soon.json`). The brief names the newest; answers cover the rest. On the map they are **hollow rings** (not open yet, told
  apart by shape) with their own legend entry; names and rings focus the map like other
  places. The question bar gets them in a separate `<opening_soon>` block (at most 30) and is
  told never to call them open.
- **`/api/ask`** (the only Claude call at request time):
  - caps checked *before* calling Claude, in Upstash Redis: 200 questions/day in total and
    20 per visitor (`ask:g:<date>`, `ask:v:<visitor>:<date>`, Pacific date). Questions are
    limited to 500 characters;
  - **fails closed:** if Redis is unreachable or a cap is hit, it returns 429 with a friendly
    message, and the rest of the page keeps working;
  - `claude-haiku-5-5`, thinking disabled, effort low, `max_tokens` 600, structured output (`ANSWER_SCHEMA`: `summary` + `picks` of `{id, blurb}`);
  - restaurant data goes in a delimited block marked as data, and the system prompt says to
    answer only from it (prompt-injection defence). The block holds at most 100 places
    (`MAX_DATA_ROWS`): the nearest once located, else the top-ranked, with tried places
    removed first. Every row carries its place `id`; `resolvePicks` keeps only picks whose id
    is a real place (open or opening soon), at most 5 (`MAX_PICKS`), with name, city and kind
    taken from our data, so a card can never show an invented place.
  - **search (SAN-58):** the 100-place block is a subset, so questions that count, name a place
    or filter (city, cuisine, kind, date) go through a search over **every** place
    (`findOpenings` in `app/lib/search.ts`: exact count plus up to 20 places, newest first or
    nearest once located; Opening soon on request). Claude asks for it inside its structured
    reply (`ANSWER_WITH_SEARCH_SCHEMA`'s `search`, strict filters), not as a tool: with a strict
    answer format, Haiku 5.5 replies in JSON instead of calling tools. The server runs it and
    sends the result back in a `<search_results>` data block; Claude answers from it and states
    the filter ("Counting places in Kirkland first inspected since Nov 1: 1"). At most
    `MAX_TOOL_ROUNDS` (2) searches, so a question is at most 3 Claude calls; the last request
    can't ask for a search. The prompt carries today's Pacific date and fixed meanings ("this
    week" = last 7 days, "this month" = since the 1st, "recently" = last 30 days). A cut-off or unreadable
    reply returns a fixed message and no picks. Text is never rendered as HTML; an answer built from the
    labelled sample ends with "(Answered from sample data, not today's list.)";
  - order in `app/app/api/ask/route.ts`: session → body (question ≤ 500 chars) → visitor
    cookie → API key present → caps (visitor counter, then global; refused questions count)
    → Claude (no SDK retries; one question is one to three calls). A missing API key returns 503 without counting; Redis
    missing or down returns 429. Questions and locations are never logged.
- **Question bar** (`app/components/AskBar.tsx`, `app/lib/askClient.ts`): a text box (500
  characters max) that grows with the question up to six lines, so it stays readable on a
  phone (Enter sends; a × appears with text and clears it, keeping the last answer), and up to four chips from the Today brief. The browser sends the question with the visitor's
  location and "Tried it" ids; the reply is `{answer, picks, left}`, and the bar shows the answer as
  plain text and "N left today", then one card per pick (`app/components/AnswerPicks.tsx`):
  number, name, street and city (`addressLine`, so same-name places are told apart), up to four
  fact bubbles built from our data (`openingFacts` / `openingSoonFacts` in `lib/format.ts`:
  likely cuisine, "first inspected <date>" when a later inspection exists (opening dates aren't
  in the data) or "licence applied <date>" for Opening soon, the **latest** inspection as the county shows it,
  e.g. "Unsatisfactory · 30 pts · Jun 16" (`latestInspection`: its verdict, its score = red +
  blue points, the date; never the first inspection), distance), Claude's blurb on why it fits,
  and "Tried" for
  open places. Facts never come from Claude; an educational first visit is sent with no red
  points so it can't be called clean. The picks take over the numbered map pins (card order) until the next question;
  tapping a name flies the map there, as in the lists. A cap hit or error shows the server's message instead.
- **Wording (SAN-59):** the app never states an opening date. "Just opened" means first inspected
  by the county, which usually comes weeks after opening; Opening soon means a liquor licence
  application, which isn't a promise (about 55% of 2026's King County restaurant applications
  had a first inspection by November). The About panel says both; Claude's rules forbid "opened
  on <date>" and promising that an applicant will open.
- **Answer style:** a one-sentence summary (under 25 words) plus at most 5 picks, each with a
  one-sentence blurb (under 15 words) on why it fits, not restating the fact bubbles. "Tried"
  sits on the name's line, right-aligned, on every screen size. "Likely <cuisine>" for
  inferred cuisine. "Wary" answers go by the latest inspection (Unsatisfactory = a concern; points are the county's score), and blurbs say what went wrong, not the numbers on the card. Say plainly
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
