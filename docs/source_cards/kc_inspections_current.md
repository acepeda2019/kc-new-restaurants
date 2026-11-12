# Source card: King County food inspections, current (`r878-4sxa`)

Citations: `[NN]` = script `exploration/kc_inspections/NN_*.sql|sh`; `[agg/x]` = JSON output of `01_current_aggregates.sh`
(files in git-ignored `exploration/kc_inspections/data/agg/`); `[meta]` = `00_metadata.sh` output in `data/meta/`.
SQL scripts run from `data/`. Today = 2026-11-12.

- **Owner / publisher:** Public Health - Seattle & King County, on data.kingcounty.gov. Title "Food Establishment Inspection Data" [meta/views_r878-4sxa.json]. Dataset ID `r878-4sxa` is correct.
- **Access:** SODA `https://data.kingcounty.gov/resource/r878-4sxa.json` works unauthenticated (no app token used; 50,000-row pages OK) [01, 04]. CSV export not tested.
- **License / terms:** portal metadata `license = {name: Public Domain}`, attribution "Public Health - Seattle & King County" with link to kingcounty.gov restaurant-safety-ratings page [meta]. No separate terms text was fetched; storing and displaying is permitted by "Public Domain", and we should still show the attribution. Low-medium confidence: the KC open-data terms-of-use page was not read.
- **Refresh cadence observed:** `rowsUpdatedAt` = 2026-11-12 15:15:42 UTC; every one of 111,644 rows has the same `:updated_at` = `:created_at` = 2026-11-12T15:15:09.798Z [agg/cur_system_fields, 18]. A re-query ~6.5 h later gave identical values [18]. So the table is rewritten wholesale on refresh (consistent with the dataset being created 2026-03-04 and published 2026-05-19 [meta], matching the spec's "May 2026" republish). Max inspection date = 2026-11-12 (today; 1 inspection), previous day 11-10 had 107, 11-11 none (holiday) [agg/cur_recent_dates]. Data lag is about 0 to 2 business days. Only one refresh was observed; cadence (daily vs weekly) is unconfirmed. Compare two pulls on later days.
- **Coverage:** 2021-01-04 to 2026-11-12; King County (117 raw city spellings, 69 distinct after upper-casing) [01 cur_values_city, 17]. No latitude/longitude (see traps).
- **Profiled on:** 2026-11-12. Full-dataset SoQL aggregates (111,644 rows, 75,181 inspections, 12,356 businesses) plus a 50,000-row sample of the most recent rows (2024-10-25 to 2026-11-12) [04, agg/cur_totals].

## Grain
One row per **violation**, and one row for an inspection with no violation.
- 111,644 rows; 75,181 distinct `inspection_serial_num`; each serial has exactly one (business_id, date, type, result, score) combination [10, agg/cur_inspections_*].
- 33,575 inspections have 1 to 19 rows (70,038 rows, all with `violation_description`); 41,606 inspections (55%) are exactly one row with null `violation_type/description` and `violation_points = 0` [10, agg/cur_nonnull]. This is how zero-violation inspections appear.
- No duplicate (serial, violation_type, violation_description) [agg/cur_dup_violations = `[]`]. There is **no violation ID column**; the violation key is (serial, violation_description) (the description starts with a 4-digit code, e.g. "4100 - Warewashing...").
- Spec says one row per violation: confirmed. Description text says "each row is an inspection", which is loose wording.

## Keys
| Candidate key | Unique? | Null rate | Notes |
|---|---|---|---|
| `business_id` (business) | one row per id after grouping on all business attributes: 12,356 attribute rows = 12,356 ids, so no attribute drift (name, address, ZIP, class, seating, risk, parcel all constant per id) [11] | 0% | Format `PFE-PR-<7 digits>` (11,450 ids), `PFE-PR-<6 digits, from 500003>` (734 ids, all first inspected 2026-01-05 or later), `SFE-PR-` (172, seasonal) [11, 15]. Attributes are the latest snapshot per id, so no history of renames. |
| `inspection_serial_num` (inspection) | unique per inspection (75,181 = 75,181) [10] | 0% | Prefix `PFE-` (permanent) or `SFE-` (seasonal) then either the legacy 9-char code (len 13), `RT-<n>-<yyyy>` style (len 18 to 19, from 2024-02-21) [10]. |
| (`inspection_serial_num`, `violation_description`) | unique [agg/cur_dup_violations] | desc null in 41,606 rows (zero-violation rows) | Use a surrogate incl. row presence; no native violation ID. |
| Socrata `:id` | unique per row in 50k sample [04] | 0% | Not stable across republish; do not use as key. |
| `parcel_number` | not a key | 0.5% null rows; 215 businesses null [agg/cur_nonnull, 11] | 6,252 distinct parcels; could help address matching. |

## Columns that matter
20 columns exactly (from `api/views` and `$select`): `name, program_identifier, inspection_date, classification, address, city, zip_code, inspection_type, inspection_score, inspection_result, inspection_closed_business, seating_range, risk_category, violation_type, violation_description, violation_points, grade, parcel_number, business_id, inspection_serial_num` [meta]. Everything arrives as text in JSON (scores like "0.00").

| Column | Type | Null % | Distinct | Example | Use |
|---|---|---|---|---|---|
| name | text | 0 | 9,921 | `PHO 25 LLC` | display / matching; mixed case (784 businesses not upper-case) [11] |
| program_identifier | text | 82.0 (91,574 null rows; 9,813 of 12,356 businesses) | 2,354 | `LUNCHROOM`, `ALBERTSONS #3416 BAKERY`, `EL CAMION (3) @ 4529 SAND POINT WAY NE` | sub-unit / stall / truck label [agg/cur_values_program_identifier, 11] |
| inspection_date | calendar_date | 0 | | 2026-11-10 | 2021-01-04 to 2026-11-12 |
| classification | text | 0 | 15 | `General Food Services` | category seed input |
| address | text | 0 | 9,561 | `10439 16TH AVE SW, C` | no lat/long; 2,251 of 12,356 have a comma-suffixed unit, 727 contain unit/ste/suite/# [17, 11]; 52 do not start with a number (e.g. `SEA-TAC AIRPORT, ConD`, `SUMMIT STEVENS PASS US HWY 2`) |
| city | text | 0.01 (11 rows) | 117 raw | `Seattle`, `SEATTLE`, `BELLEUE` | casing and typos; derive area from ZIP instead |
| zip_code | text | 0 | | 98101 | 22 businesses have ZIP+4 [11] |
| inspection_type | text | 0 | 3 | see below | |
| inspection_score | number | ~0 (1 null) | | 0 to 149; min -1 seen in sample [04] | |
| inspection_result | text | 0.004 (4 rows) | 3 | Satisfactory | |
| inspection_closed_business | text Yes/No | 0 | 2 | No | "Yes" = 40 inspections, 39 businesses [agg/cur_values_inspection_closed_business] |
| seating_range | text | 21.7 rows (87,457 non-null) | 5 | `13-50` | null for non-seated classes |
| risk_category | text | 0.6 | 3 | 3 | |
| violation_type | text | 37.3 | 2 | RED / BLUE | |
| violation_points | number | 0 | 0 to 25 [04] | 5 | |
| grade | text | 0 | 6 | Excellent | |
| parcel_number | text | 0.5 | 6,252 | 9206000005 | |
| business_id, inspection_serial_num | text | 0 | 12,356 / 75,181 | | keys |

Missing vs the spec: **no latitude/longitude, no phone, no UBI, no license number, no violation record ID** [meta, 04].

## Entity-resolution fields
- Name: case-mixed, includes store numbers (`SAFEWAY #2734`), and for mobile units embedded permit tokens `KC####` (248 of 695 mobile names) [17]. `program_identifier` differs from name for only 2,531 businesses and equals it for 12 [11]; elsewhere null.
- Address: street + optional unit after a comma (`17620 140TH AVE SE, C-7`) or ` STE 105` / `#120`; mixed case in part; legacy and current differ in abbreviations for the same inspection (`2725 NE SUNSET BL` vs `... BLVD`; 1,204 of 1,760 compared Safeway inspections differ in address text [16]), so normalise street suffixes.
- ZIP 5-digit with 22 ZIP+4; city unreliable. No coordinates: geocoding, or a name+address join to the legacy business lists (`sgr5-u9rw`, with lat/long), is needed for any map. Name+address join matched 9,388 of 12,356 current businesses (76%) to those lists [13].
- Parcel number is a possible address-level join key (6,252 distinct).

## Classification fields (distinct values with counts; seed to be written later)
Counts are rows / businesses / inspections [agg/cur_values_*] unless stated.

**classification** (business type; constant per business):
| value | businesses | candidate mapping |
|---|---|---|
| General Food Services | 8,813 | restaurant (default); cafe/dessert when name says so; food_hall_stall when multi-tenant |
| Mobile Food Unit | 695 | food_truck |
| Grocery Store | 904 | excluded |
| Meat/Fish Market | 395 | excluded |
| School Lunch Program | 468 | excluded (institutional) |
| Nonprofit Institution | 271 | excluded (ambiguous: churches, shelters, senior meals) |
| Catering Operation | 331 | excluded (caterer) |
| Bakery | 239 | ambiguous: 235 have null seating and are mostly in-store grocery bakeries (`ALBERTSONS #3416 BAKERY`); a few standalone bakeries [11] |
| Limited Food Service | 113 | ambiguous: mostly espresso/coffee stands (`WIRED CHICK'S ESPRESSO`), seating and risk null; cafe_bakery_dessert candidate |
| General Food Service (singular) | 82 | all `SFE-` ids: seasonal sites (swim club, theme park, mountain pass pub) [11]; likely excluded as seasonal/temporary; ambiguous |
| Commissary Kitchen / Commissary Kitchen Exempt from | 28 / 2 | excluded |
| DFDO / DFDO Exempt from billing | 2 / 8 | meaning unknown (low confidence); exclude pending clarification |
| Bed and Breakfast Operation | 5 | excluded |

**seating_range** (by rows): `13-50` 31,801; `0-12` 25,000; `51-150` 24,433; null 24,187; `151-250` 3,899; `> 250` 2,324. **risk_category**: 3 = 93,829 rows (9,018 businesses); 2 = 9,604; 1 = 7,517; null 694. In General Food Services: seating non-null for all but 28 businesses; risk 3 dominates [11 crosstab, agg/cur_values_class_seat_risk].
**inspection_type**: `Routine Inspection/Field Review` 70,614 inspections; `Return Inspection` 2,215; `Educational Inspection` 2,352 (only 3 values). **inspection_result**: Satisfactory 50,069; Unsatisfactory 22,243; Complete 2,865; null 4 inspections. **grade**: Excellent, Good, Okay, Needs To Improve, Not Rated, Rating Not Available. **violation_type**: RED, BLUE, null. Results by type: Educational is nearly all "Complete" with 0 points [agg/cur_values_type_result, 10].
- No field says "restaurant" vs "cafe" vs "food hall". cafe_bakery_dessert has to come from name keywords (see [19] for counts; unreviewed, expect false positives such as `STEAK`/`TEA` substrings) plus Limited Food Service and Bakery. food_hall_stall has to come from the multi-tenant address flag.
- Legacy `description` ("Seating 0-12 - Risk Category III") is **not** a current column; it maps 1:1 to seating/risk/classification [16].

## Pre-opening inspection type?
**No.** Only Routine, Return, Educational exist [agg/cur_values_inspection_type]. First-ever inspections of businesses first seen 2023-01 or later (4,404 businesses): Routine 4,123 (94%; 74% Satisfactory), Educational 276 (6%, all zero violations), Return 5 [13]. Routine first inspections average 0.94 violations and score 6.8. So the first inspection is a routine inspection a few weeks to months after opening; the spec's "first inspection = just opened" is workable but is a lagging signal. Business permit and open date are not in the data. Low-medium confidence on the lag since permit/open dates are unavailable.

## Ownership changes
- Business attributes never change within an ID [11], so a change of owner or concept must show up as a new ID.
- Among 4,153 General Food Services / Limited / Bakery businesses first inspected after 2022-06-01, 145 (3.5%) have another business ID at the same unit-stripped address whose last inspection is within 12 months before (or 30 days after) the new ID's first inspection (addresses with 8+ businesses excluded): 13 with the exact same name, 15 with Jaro-Winkler name similarity at least 0.90, 1 at 0.75 to 0.90, 129 below 0.75 (new concept or a different tenant at a multi-unit address, since unit stripping merges neighbours) [14].
- Examples with same name, new ID: `Porter Hospitality` (new ids 503102, 503103 vs 3150655, 58 days), `RAINBOW CAFE` vs `rainbow cafe`, `Broadmoor Golf Club` (3 old ids to 1 new id, same day) [14].
- Confound: the new 6-digit id family (734 ids, issued from 2026-01-05) includes re-issued ids for existing businesses: 79 of 734 share name and address with another id [15], and only 89 of 734 match the legacy lists by name+address [13] (many existing businesses were already re-keyed via `PFE-PR-31xxxxx`; new-system ids may also be re-issued after relicensing). Estimated frequency of true ownership transfer: a few percent of new ids, medium-low confidence.

## Food trucks / mobile units
- Identified by `classification = 'Mobile Food Unit'`: 695 businesses, 495 inspected in the last 12 months [11, 17].
- `address` is **not a serving location**: 251 of 345 distinct addresses have one unit, but 360 units sit at addresses shared by 3 or more units, 130 share an address with a commissary-class business, 551 share with any non-mobile business [14]. Largest: 800 Occidental Ave S (Lumen Field, 60 units), 10836 E Marginal Way S Tukwila (28), 360 Corporate Dr N Tukwila (21), Arena at Seattle Center (15), T-Mobile Park (12). 87 units have addresses at the three stadium/arena venues [17].
- Serving location appears only as free text in `program_identifier` for 253 of 436 non-null mobile labels (e.g. `EL CAMION (3) @ 4529 SAND POINT WAY NE`, `@VARIOUS LOCATIONS`) while the `address` column is the commissary or base (`11728 AURORA AVE N`) [17]. Confirms the spec's assumption; no map pin should use `address`.
- Mobile units are mixed with temporary-event vendors at stadiums (`LEVY RESTAURANTS @ LUMEN FIELD`).

## Multi-tenant addresses
Counting classes General Food Services/Service, Limited, Bakery, Mobile, inspected in the last 365 days (unit-stripped, case-folded address) [15]: 6,389 addresses; 1,026 have 2 or more active businesses (3,457 businesses); 900 have 2 or more non-mobile, 109 have 5 or more non-mobile. Top: 800 Occidental Ave S (105; 46 mobile), 1250 1st Ave S (68), 17801 International Blvd (SeaTac airport, 67), 334 1st Ave N (61), 15600 NE 8th St Bellevue (32, food hall style), 2300 Ron Crockett Dr Auburn (Emerald Downs, 20), 701 5th Ave (Seattle, 19), 2800 Southcenter Mall (16), 36201 Enchanted Pkwy S (16). Unit suffixes are stripped for this count, so strip-mall neighbours are included; a high threshold (about 5 or more) or distinct-unit logic is needed for `is_multi_tenant`.

## New-openings volume (first-ever inspection per business id)
Count of ids by month of first inspection in this dataset [13] (legacy business lists `sgr5-u9rw` + `j2pu-r4ru` used to remove ids that already existed by name+address; those lists end Dec 2025, so for later months the legacy filter only excludes pre-existing businesses):
| month | new ids | not in legacy list by name+addr |
|---|---|---|
| 2025-11 (full month; only 11-13 onward is in the 12-month window) | 109 | 36 |
| 2025-12 | 48 | 38 |
| 2026-01 | 74 | 63 |
| 2026-02 | 67 | 49 |
| 2026-03 | 57 | 47 |
| 2026-04 | 77 | 63 |
| 2026-05 | 81 | 68 |
| 2026-06 | 97 | 83 |
| 2026-07 | 78 | 68 |
| 2026-08 | 118 | 107 |
| 2026-09 | 132 | 113 |
| 2026-10 | 156 | 137 |
| 2026-11 (to 11-12) | 68 | 57 |
Last 12 months (2025-11-13 to 2026-11-12): 1,119 first-ever ids; 914 without a name+address match in the legacy lists; 977 in restaurant-like classes (General Food Service(s), Bakery, Limited, Mobile); 707 in General Food Service(s)/Bakery/Limited (non-mobile) and not in the legacy list [13]. Roughly 60 to 150 per month overall; about 50 to 130 per month in plausible restaurant classes after dropping ownership and re-keyed ids. Left-censoring: ids first seen in 2021 to mid-2022 (hundreds per month) are an artefact of the dataset start [12]. Pre-2021 history of businesses is available only in the (inaccessible) legacy table, so "first-ever" before 2021-01 is checked only through the legacy business lists by name+address (medium confidence).

## Quirks and traps
- **No lat/long** in current; spec lists lat/long as an expected key field. Legacy has them (see legacy card).
- **Keys changed at republish.** Current `inspection_serial_num` = `PFE-` + legacy serial (2,145 of 2,145 shared Safeway inspections match with identical row counts, scores, points) but `business_id` was re-keyed: legacy `PR0071271` = current `PFE-PR-3137340`, with no arithmetic relation. The mapping is recoverable only through shared serials (1:1, 350 pairs in the Safeway sample) [06, 07].
- After the Nov 2025 switch, new serials have a different format (`PFE-RT-0472333-2026`) and new businesses get 6-digit ids from 500003 [10, 15]. Ids and serials from 2024-02-21 already show the new serial format [10].
- Current drops many legacy Consultation/Education inspections: 336 of 2,481 Safeway legacy 2021+ inspections are absent (305 educational, 31 routine/return) [08]. Legacy rows dropped from current are not necessarily in legacy either (legacy is inaccessible).
- 6-digit ids can re-issue existing businesses (79 of 734 share name and address with another id) [15].
- `:updated_at` is a single value for all rows, so it is useless for incremental pulls; `:created_at` likewise [18]. Full pull (3 pages of 50,000) is cheap; plan full pulls and dedupe on (serial, violation).
- Legacy `grade` was numeric 1 to 4, current is text; `violation_type` RED/BLUE differs between legacy and current for some of the same inspections (join on serial only, so row counts are inflated; 187 RED-to-BLUE and 187 BLUE-to-RED pairs) [16]; do not assume the colour is stable.
- Score min is -1 in a sample; 17 inspections have violations but score 0, 18 have score above 0 with no violations [10]. Do not derive safety signals blindly.
- 100 (business, date) pairs have more than one serial [10]; this is multiple programs inspected on the same day, not duplicates.
- City values: 117 spellings (`SEATTLE`, `Seattle`, `Seattle,`, `Seattle tacoma`, `BELLEUE`).
- `program_identifier` sometimes carries permit codes and addresses; `name` carries `KC####` tokens for trucks.

## Proposed staging model
`stg_kc__inspection_violations` (grain violation): rename/cast only; cast `inspection_date` to date, scores and points to numeric, `inspection_closed_business` Yes/No to boolean; trim and uppercase name/address for a normalised column only in intermediate. Surrogate key from (`inspection_serial_num`, `violation_description`, row number within serial for zero-violation rows).
`stg_kc__inspections` (grain inspection): distinct on `inspection_serial_num` with business and inspection attributes, `violation_count`, `violation_points_total`. Primary key `inspection_serial_num`. Strip the `PFE-`/`SFE-` prefix into `serial_core` to allow legacy dedupe.

## Proposed tests
- `unique`, `not_null` on `inspection_serial_num` (inspections) and the violation surrogate key.
- `not_null` on `business_id`, `inspection_date`, `classification`.
- `accepted_values` on `classification` (15 values, warn level), `inspection_type` (3), `inspection_closed_business`, `violation_type`.
- relationship: every inspection's `business_id` has exactly one set of business attributes.
- Row-count and freshness: `max(inspection_date)` within 7 days of today (warn), row count not below the prior pull by more than 1%.
