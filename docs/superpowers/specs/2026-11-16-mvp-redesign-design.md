# MVP redesign: King County New Eats

Date: 2026-11-16. Status: draft for owner approval.
Supersedes the architecture in `docs/PROJECT_SPEC.md` §5 and the v1 scope in §3/§8
once approved (the spec and `docs/decisions.md` get updated as part of the work).

**Design history** (private claude.ai artifacts; the owner shares them as needed):
- Original UI design, from the v0.4 spec era. Kept for history only; **not** the target design: https://claude.ai/artifact/R5vqPzUpFJSVt8pun5XuCe
- MVP UI mockup (dark map, floating panels): the target for Tasks 8–10: https://claude.ai/artifact/DtEGBA9Zv91zrdhsophvgB

## 1. Intent

**User intent:** *"Show me what restaurants just opened near me, and tell me briefly why each
one is worth a look."*

A small, private web app (owner + a few friends) with:
- a **map** of recently opened restaurants,
- **headline metrics** (e.g. "23 restaurants opened in the last 30 days"),
- a **top 3 to try** list, each with a one-line reason,
- a **question bar** where users ask about the data in plain English and get short answers.

**Why now:** the first week produced ~3,500 lines of infrastructure (AWS Step Functions,
Lambda, Snowflake, Terraform) and nothing a user can see. The owner wants an MVP before
scale, built in the AI-native style of `~/.claude/rules/build-for-2028.md`.

**Portfolio goal (unchanged):** show analytics engineering end to end (governed dbt models
with tests, entity/classification logic, a usable app) in a form a reviewer grasps quickly.

## 2. Goals, non-goals, anti-goals

**Goals (MVP)**
- "Just opened" restaurants in King County from KC food inspections, refreshed daily.
- Claude makes the judgment calls the data can't answer, each with a confidence score.
- Map + metrics + top 3 + question bar, usable on a phone.
- Hard cost caps; private access.

**Non-goals (later scope, in this order)**
1. "Opening soon" (WA LCB liquor-license notices + matching to inspections).
2. Press buzz (RSS headlines).
3. Ratings (Google Places, within its terms).
4. Survival analysis, Snohomish County, detail pages, accounts.

**Anti-goals (failure even if it works)**
- Inventing facts: calling a place "good" with no ratings data, or stating cuisine as fact.
  Inferred values are labelled ("likely Indian").
- Opinions about safety: "wary" answers cite inspection records only.
- Runaway spend: any path where traffic can raise cost past the caps.
- Rebuilding the heavy infrastructure this replaces.

## 3. Constraints

- **Cost:** Claude Haiku 5.5 only (`claude-haiku-5-5`). Estimated ~$0.002/question;
  ~$1–3/month at friend-test volume. Everything else on free tiers.
- **Hard caps (all required):** global daily question cap; per-visitor daily cap;
  short `max_tokens` on answers; dedicated Anthropic API key for this app (plus a
  Console spend limit if the account offers one); shared passcode gate.
  When a cap is hit, the question bar says so; map, metrics and lists keep working.
- **Data rules from the existing spec stay:** categories (`restaurant`,
  `cafe_bakery_dessert`, `food_hall_stall`, `food_truck`; exclude grocery, institutional,
  caterers, temporary events, stadium/airport vendors), opening types (`new_opening`,
  `new_concept` with "replaces X", `ownership_transfer` excluded), food trucks get no pin,
  180-day "just opened" window. See `docs/PROJECT_SPEC.md` §6–7 and the source cards.
- **Secrets** never in the repo: GitHub Actions secrets and Vercel env vars only.
- **Google Places** terms still apply if/when ratings arrive (store `place_id` only).

## 4. Approaches considered

| | A. Next.js on Vercel (**chosen**) | B. Streamlit, all Python | C. Cloudflare Pages + Worker |
|---|---|---|---|
| App | Custom page from v0: map, metrics, top 3, question bar | Built-in widgets | Static page + Worker for questions |
| Caps store | Upstash Redis (free tier) | File/DB (host restarts) | Workers KV |
| Privacy | Passcode we build | Built-in email invites | Cloudflare Access |
| Trade-off | Two languages, one extra service; best product feel, matches v0 practice | Fastest; generic look, weak on phones, cold starts | Cheapest/most private; new platform |

Owner picked **A**: the experience is the product, it must work on a phone, and it keeps the
v0/Next.js practice goal. **dbt** kept (over a plain Python + DuckDB script) for tests that
enforce the domain rules, generated lineage docs, and portfolio value.

## 5. Design

### 5.1 Flow

```
GitHub Actions (daily cron + manual workflow_dispatch)
  1. extract   ingestion/sources/kc_inspections.py   → s3 raw/kc_inspections/dt=…/
  2. geocode   ingestion/sources/census_geocoder.py  → s3 raw/census_geocoder/dt=… (new addresses only)
  3. classify  Python + Claude Haiku: only never-seen businesses → classifications file in S3
  4. build     dbt build (dbt-duckdb) reading raw files from S3 → mart_new_openings (+ tests)
  5. publish   export openings.json + metrics.json → Vercel Blob (or S3) → Vercel deploy hook
Vercel (Next.js)
  page:  reads openings.json at build time → map, metrics, top 3 (static)
  /api/ask: passcode check → caps check (Upstash) → Haiku with openings.json as context → short answer
```

If any step fails, nothing is published and the site keeps the last good data.
A GitHub Actions failure email is the alert.

### 5.2 Data model (dbt, DuckDB)

| Model | Grain | Purpose |
|---|---|---|
| `stg_kc__inspection_violations` | violation | rename/cast raw KC rows |
| `stg_kc__inspections` | inspection | dedupe violations to inspections |
| `stg_census__geocodes` | normalized address | lat/long + match quality |
| `stg_claude__classifications` | KC business_id | Claude's category, opening type, replaces_name, likely cuisine, confidence, reason, model, classified_at |
| `int_establishments` | KC business_id | first/last inspection, address, coordinates, first-inspection result and critical points |
| `mart_new_openings` | restaurant (KC business_id) | the app table: first inspected within 180 days, accepted category, not an ownership transfer, score, rank, one-line "why it's here" |
| `mart_metrics` | one row | headline numbers (opened last 30 days, by area, etc.) |

**Identity (simplified):** `restaurant_id` = KC `business_id` for the MVP. The persisted
ID map, merges and splits from the old spec are dropped until "Opening soon" needs
cross-source identity.

**Tests that enforce the domain rules:** unique + not_null keys; no `ownership_transfer`
or excluded category in `mart_new_openings`; `replaces_name` present exactly for
`new_concept`; confidence between 0 and 1; non-truck rows have coordinates; source freshness.

### 5.3 Claude judgment calls (step 3)

**Rules first, Claude for the rest** (builder's call, approved with this doc): clear-cut
cases stay deterministic in seeds and dbt, as in the old spec: KC `classification` →
category (e.g. "Mobile Food Unit" = `food_truck`, institutional/grocery classes excluded),
`venue_exclusions.csv`, `is_multi_tenant`, and the 180-day window. Claude decides only
what rules can't: café vs restaurant, in-store vs standalone bakery, "Limited Food
Service" cases, and `new_opening` / `new_concept` / `ownership_transfer`. dbt tests check
both the rule logic and Claude's output.

**Only candidates go to Claude:** businesses first inspected within the 180-day window
that the rules didn't exclude (hundreds on the first run, a handful per day after). So the
build is split: `dbt build` staging + intermediate → classify → `dbt build` marts.

- Input: each candidate never classified before (name, address, KC classification,
  inspection history, other businesses at the same address in the prior 12 months).
- Output (structured): `category` (or excluded), `opening_type`, `replaces_name`,
  `likely_cuisine` (nullable), `confidence` 0–1, `reason` (one line).
- Each business is classified once and cached; re-classify only if its inputs change.
- **Confidence rule:** at or above a threshold (a seed value) → used automatically;
  below → held out of the app and listed as pending review.
- **Review:** the owner asks Claude Code "what's pending?"; decisions are saved to a
  seed CSV of overrides (`seeds/classification_overrides.csv`) that always wins.

### 5.4 Ranking (MVP)

Newest first with a small boost for a clean first inspection, per the existing spec's
"Just opened" formula without buzz: `100 × (w_fresh·freshness + w_safety·safety)`,
weights in a seed. Each mart row carries a one-line "why it's here" assembled from facts
(first inspection date, clean/critical result, "replaces X", Claude's reason).

### 5.5 App (Next.js on Vercel, UI from v0)

```
┌─────────────────────────────────────────┐
│  Ask anything about new restaurants…  ⏎ │
├─────────────────────────────────────────┤
│  23 opened in last 30 days · 5 in your  │
│  area · 18 passed first inspection clean│
├─────────────────────────────────────────┤
│              [ map with pins ]          │
├─────────────────────────────────────────┤
│ Top 3 to try                            │
│ 1. Sweet Spot Bakery — opened Oct 28,   │
│    clean first inspection, 0.3 mi       │
│ 2. …                                    │
└─────────────────────────────────────────┘
```

- **Private site:** the whole site (page, data and `/api/ask`) sits behind one shared
  passcode checked by Next.js middleware with a cookie. The JSON is served only through
  the app, never from a public URL (builder's call, from "keep the project private").
- **Areas:** "near me" / "in your area" = a radius around the browser's location, computed
  in the browser. "In [place]" questions use ZIP and a normalized city. The hand-built
  ZIP → neighborhood seed is deferred (builder's call: KC city values are messy, and
  inventing neighborhood boundaries breaks the no-invented-data rule).
- **Wary answers:** `openings.json` carries, per restaurant, the first and latest inspection
  result, critical points and short violation descriptions (red critical only), so Haiku
  can cite records without a large context (builder's call).
- "Near me" uses browser geolocation (asked on demand; never stored server-side).
- "Tried it" is stored in the visitor's browser only (no accounts); sent with each question
  so answers can exclude tried places.
- **Top 3 is personal (owner decision):** the mart's score is the default order; the browser
  re-ranks by score plus distance from the visitor and drops places marked "Tried it". No
  extra cost: the full openings list is already on the page.
- **Answer style:** at most 3 recommendations, one-line reason each; say plainly when the
  data can't answer (hours, price, ratings, opening soon).
- First questions to support: newest near me; ones I haven't tried; new by cuisine
  (labelled "likely"); anything to be wary of (cites inspections); new in [area] this month;
  pick one for tonight; tell me about [restaurant].

### 5.6 What gets removed

Step Functions, EventBridge, Lambda handlers and `dispatch.py`, Snowflake (all objects,
RBAC, resource monitor), Secrets Manager, SNS/CloudWatch alarms, the Vercel IAM user, and
the current `pipeline.yml`. None of it was ever deployed (`terraform apply` never ran,
owner confirmed 2026-11-16), so removal is code deletion only. Terraform shrinks to the raw S3 bucket and a GitHub OIDC role
(or the bucket is created once by hand; builder's call). The extractors, their tests, source
cards, spec rules and decision log stay.

## 6. Left to the builder

- Exact confidence threshold starting value, freshness/safety weights (start from the spec's
  judgment values).
- Cap values (suggested: 200 questions/day global, 20/visitor/day, answer `max_tokens` ~300).
- Vercel Blob vs S3 for the published JSON.
- Prompt wording for classification and answers.
- Map library (MapLibre + free tiles) and tile provider.
- PR split (target ~200 lines each, bottom-up: pipeline → dbt → classify → app → ask).

## 7. Follow-ups outside this design

- Update `docs/PROJECT_SPEC.md`, `docs/decisions.md` and `CLAUDE.md` (stack, guardrail 1
  now allows a capped live AI question bar) to match.
- Connect Linear and create tickets from the PR split.
