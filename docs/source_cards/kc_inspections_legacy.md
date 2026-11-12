# Source card: King County food inspections, legacy (`f29f-zza5`)

Citations: `[NN]` = script `exploration/kc_inspections/NN_*.sql|sh` (SQL runs from `data/`); `[meta]` = `00_metadata.sh` output in git-ignored `data/meta/`.
Today = 2026-11-12.

**Headline: the legacy dataset itself is not publicly readable. Everything below about its row-level contents comes from public derived views, which expose only a Safeway/Albertsons subset at row level and business-level lists for the rest.** The spec's access assumption ("CSV") is unverified and, via the API, wrong.

- **Owner / publisher:** Public Health - Seattle & King County, data.kingcounty.gov. ID `f29f-zza5` exists but is private.
- **Access (verified):**
  - `GET /resource/f29f-zza5.json?$limit=1` returns HTTP 403, `authentication_required` [00_metadata.sh, data/meta/legacy_resource_probe.json].
  - `GET /api/views/f29f-zza5.json` returns `authentication_required` [meta/views_f29f-zza5.json]; `rows.csv?accessType=DOWNLOAD`, `rows.json` and `/api/v3/views/f29f-zza5/query.json` return 403 [00_metadata.sh, session probe].
  - The catalog does not list it (`catalog/v1?ids=f29f-zza5` returns 0 results; `q=food inspection` returns only r878-4sxa as a KC inspection dataset) [meta/catalog_kc.json, meta/catalog_kc_food.json].
  - Public derived views of it that still answer (type `filter`, rows last written 2025-12-04T22:36 UTC) [03, meta/derived_f29f.json]:
    | view | content | rows |
    |---|---|---|
    | `29us-kypr` "safeway-or-albertson" | all 22 legacy columns, Safeway/Albertsons rows only | 12,164 rows, 356 businesses, 9,929 inspections |
    | `mzbk-wwns` "safeway-or-albertson-by-name" | same filter by name | 6,455 rows |
    | `sgr5-u9rw` "Businesses Food-King County" | one row per business: `business_id, name, address, city, latitude, longitude, grade` | 10,403 businesses |
    | `j2pu-r4ru` "Food Establishments" | one row per business: name, address, city, zip, `location` point, `inspections` count, `business_id`; written 2024-09-09 | 12,641 businesses (11,780 with a point) |
  - Action needed from the owner: obtain the f29f-zza5 export (the spec's CSV) by hand, or ask KC to make it public. Until then 2006-2020 history is unavailable except through the business lists.
- **License / terms:** derived views carry `license = Public Domain`, attribution Public Health - Seattle & King County [meta/views_29us-kypr.json]. The parent's metadata cannot be read; assume the same.
- **Refresh cadence observed:** static. Derived-view descriptions say "current from 1/1/2006 to 06/28/2018" (stale text), but the rows run to 2025-11-26 [03; sample min/max below]. All rows of the derived views share one `:updated_at` of 2025-12-04 [03]. The legacy table stopped at 2025-11-26 (last inspection date seen), consistent with the spec's "Nov 2025".
- **Coverage:** Safeway subset spans 2006-01-05 to 2025-11-26 [03]; spec says 2006 to Nov 2025 (consistent, not provable for other businesses). King County.
- **Profiled on:** 2026-11-12. Samples: full derived views (12,164 / 10,403 / 12,641 / 6,455 rows) plus a current-dataset Safeway/Albertsons pull (2,946 rows, 359 businesses) for comparison [03, 05].

## Grain
One row per violation (and one row for a zero-violation inspection), same as current. Evidence from `29us-kypr`: 12,164 rows; 9,929 distinct `inspection_serial_num`; 5,364 rows have a `violation_description` and 5,364 distinct `violation_record_id` (unique, no duplicates) [16, 05]. Rows without violation text are the single row of a clean inspection [16]. Confidence medium: verified on the Safeway subset only.

## Keys
| Candidate key | Unique? | Null rate | Notes |
|---|---|---|---|
| `business_id` (`PR` + 7 digits, e.g. `PR0085929`) | one id per business in `sgr5-u9rw` (10,403 = 10,403) and `j2pu-r4ru` (12,641 = 12,641) [16] | 0 | 9,773 ids in both views [16]. **Not equal to the current ids** (`PFE-PR-3137340` for `PR0071271`). |
| `inspection_serial_num` (9 chars, e.g. `DADJQTQGT`) | per inspection in Safeway subset | 0 | Current serial = `PFE-` + this value for the same inspection [07]. |
| `violation_record_id` | unique where present (5,364) [16] | null exactly when no violation | **Not in the current dataset.** |
| Socrata `:id` | row-level, unstable | | |

## Columns that matter
22 data columns in `29us-kypr` [05, 03 describe]: `name, program_identifier, inspection_date, description, address, city, zip_code, phone, longitude, latitude, inspection_business_name, inspection_type, inspection_score, inspection_result, inspection_closed_business, violation_points, business_id, inspection_serial_num, grade, violation_type, violation_description, violation_record_id`.
Safeway-subset null rates: latitude/longitude 0% null; zip 0%; phone 65% null (4,230 of 12,164 non-null); violation columns null for 56% (clean inspections) [16].

## Schema differences between legacy and current
| Aspect | Legacy | Current |
|---|---|---|
| Business-type fields | single `description` string "Seating 0-12 - Risk Category III", "Meat/Sea Food - Risk Category III", "Bakery-no seating - Risk Category II", "Grocery Store-no seating - Risk Category I/II" | `classification` + `seating_range` + `risk_category`; maps 1:1 for Safeway subset (e.g. "Seating 0-12 - Risk Category III" to General Food Services / 0-12 / 3) [16] |
| Coordinates | `latitude`, `longitude` | none |
| `phone`, `inspection_business_name`, `violation_record_id` | present | absent |
| `parcel_number` | absent | present |
| `grade` | numeric 1 to 4 (and null) | text Excellent/Good/Okay/Needs To Improve/Not Rated; not a function of the legacy value (1 maps to Excellent 1,540 times and Good 108) [16] |
| `inspection_closed_business` | boolean | "Yes"/"No" |
| `inspection_type` | Routine Inspection/Field Review (7,440 inspections), Consultation/Education - Field (2,391), Return Inspection (98) [08] | Routine, Return, Educational Inspection |
| `inspection_result` (Safeway subset) | Satisfactory, Unsatisfactory, Complete, Baseline Data, Incomplete, Not Applicable [16] | Satisfactory, Unsatisfactory, Complete, null |
| `inspection_serial_num` | 9 chars | `PFE-`/`SFE-` + 9 chars, or newer `PFE-RT-...-yyyy` |
| `business_id` | `PR0xxxxxxx` | `PFE-PR-3xxxxxx` (re-keyed), `PFE-PR-5xxxxx` (new) |
| `violation_type` | RED/BLUE | RED/BLUE but not identical for the same violation in some cases [16] |
| Address text | e.g. `2725 NE SUNSET BL`, `... Unit 1700A` | `2725 NE SUNSET BLVD`; abbreviations differ in 1,204 of 1,760 matched Safeway inspections [16, 07] |
| `program_identifier` | filled with the name when otherwise null | null when same as name (1,421 of 1,760 compared rows equal) [16] |

The full legacy vocabulary of `description` and `inspection_type` beyond Safeway/Albertsons is **unknown** because the parent is private.

## Overlap with current and key matching (Safeway/Albertsons sample)
- Date overlap: current starts 2021-01-04, legacy ends 2025-11-26 => overlap 2021-01 to 2025-11 (matches the spec) [05].
- Legacy 2021+: 2,481 inspections / 356 businesses. Of these 2,145 (86%) exist in current under the serial `PFE-` + legacy serial; for these, row count, violation count, score and points are identical in all 2,145 [07].
- The 336 legacy-only inspections are 305 Consultation/Education and 31 Routine/Return (6 businesses wholly absent from current) [08]. By year: 2021 318 of 336 present, 2022 404/447, 2023 460/544, 2024 484/588, 2025 479/566 [07].
- Current has 0 inspections up to 2025-11-26 that are missing from legacy (stripped serials) [07].
- Business ids: **zero overlap on raw ids** (0 of 356 legacy ids appear in current) [05]. Via shared serials the mapping is 1:1 for 350 legacy ids to 350 current ids [07]. No arithmetic or text relation between the two id forms.
- Therefore dedupe key across both sets = serial with `PFE-` prefix stripped; business identity across both sets needs a bridge table built from shared serials (needs the full legacy rows) or name+address (current vs `sgr5`/`j2pu` lists matched 9,388 of 12,356 current businesses, 76% [13]).
- Implication: legacy rows for 2021 to 2025 add nothing to current except about 14% extra Educational/other inspections (Safeway-only estimate). The real value of legacy is 2006-2020 history (survival analysis, first-ever checks), which needs the private export.

## Entity-resolution fields
Names upper-case (`AFC ZENSHI @ SAFEWAY #2734`), addresses upper-case, abbreviated suffixes (`BL`), unit text appended (`Unit 1700A`) in the business lists [03 sample]; ZIP 5-digit; lat/long with 8 to 10 decimals; phone `(425) 869-7343`; no UBI or license number. Legacy business lists give coordinates for 10,403 (`sgr5-u9rw`) and 11,780 (`j2pu-r4ru`) businesses, which is the only coordinate source seen so far; current has none.

## Quirks and traps
- Parent dataset private (403); spec's source row for legacy is not usable as written. **Contradicts spec section 4.**
- Business ids and serial formats differ between datasets (above); a naive union on `business_id` double-counts all 12,000 businesses.
- Derived views' descriptions claim dates to 2018/2017 but the rows run to Nov 2025 (stale descriptions).
- Derived views are filters at fixed times and will not update; do not treat them as a feed.
- Grade and violation colour definitions differ between datasets (`violation_type` is not equal for some of the same violations).
- `inspection_closed_business` can be true while result is Unsatisfactory with grade 4.
- In DuckDB `~` is a full-string regex match; use `regexp_matches` in any follow-up.

## Proposed staging model
Not feasible until the f29f-zza5 export is obtained. Plan (pending the export): `stg_kc__inspection_violations_legacy` 1:1 with the 22 columns; derive `serial_core` = `inspection_serial_num`; union into a single `stg_kc__inspection_violations` with current using `serial_core` as the dedupe key (prefer current for 2021-2025-11-26, legacy for earlier), a `business_id_legacy` to `business_id` bridge from shared serials, and parse `description` into classification/seating/risk. Primary key: (`serial_core`, `violation_record_id` or violation description).

## Proposed tests
- `unique` + `not_null` on `serial_core` at inspection grain after the union (no serial in both sources with different attributes).
- Bridge table: each legacy `business_id` maps to at most one current `business_id` and vice versa.
- Row-count reconciliation for 2021-01-04 to 2025-11-26: legacy vs current counts within an agreed tolerance (expect legacy higher by Educational rows).
- `accepted_values` on legacy `inspection_type` and `description` once the full vocabulary is known.
