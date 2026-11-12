# Source card: US Census Geocoder (batch address geocoding)

Citations: `[NN]` = script in `exploration/census_geocoder/NN_*` (run from that folder; inputs/outputs in git-ignored `data/`).
`[doc]` = official API page https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html (fetched 2026-11-12).
`[b1]` = batch 1 (500 addresses, as in KC, with unit text) [01, 02, 03]; `[b2]` = batch 2 (213 rows: stripped variants, resubmits, probes) [04, 05];
`[b3]` = batch 3 (2,000 stripped, upper-cased addresses) [06, 07]; `[ep]` = direct GET calls to `/benchmarks`, `/vintages`, `/locations/onelineaddress`, `/locations/address` (curl, 2026-11-12).
Only 3 batch calls were made, one at a time.

- **Owner / publisher:** US Census Bureau (Geography Division). Service built on TIGER/Line address ranges (interpolated positions, not rooftop or parcel points).
- **Access:** no key, no auth, no app token. Base `https://geocoding.geo.census.gov/geocoder/` [doc, ep]. Batch: `POST multipart/form-data` to `/geocoder/locations/addressbatch` with fields `addressFile` (CSV) and `benchmark` [doc, 02]. Single: `GET /geocoder/locations/onelineaddress?address=...&benchmark=...&format=json` or `/locations/address?street=&city=&state=&zip=` [ep].
- **License / terms:** see "Terms" below. No geocoder-specific terms page found. Federal data, no storage restriction found. Medium-low confidence.
- **Refresh cadence observed:** the service is not a dataset; the benchmark `Public_AR_Current` is updated by the Census Bureau on a schedule not published on the API page (low confidence on cadence; not observable in one day). See Stability.
- **Coverage:** US, PR, island areas [doc]. All 2,000 + 474 matched KC points fell inside a KC bounding box (lon -122.6 to -121.05, lat 47.0 to 47.8) [03, 07]. Interpolated along street segments.
- **Profiled on:** 2026-11-12. 2,713 request rows in 3 batches built from the 50,000-row KC inspections sample (non-mobile only; see `kc_inspections_current.md`).

## Grain
One row per **submitted input record** (the response echoes our Unique ID). Evidence: 500 rows out for 500 in, 500 distinct ids, same set of ids as the input [03]; 2,000 out for 2,000 in, 2,000 distinct [07]. A `Match` returns one row (best candidate); `Tie` returns no coordinates (see below).

## Endpoints and parameters
| Item | Value | Evidence |
|---|---|---|
| Batch URL | `POST https://geocoding.geo.census.gov/geocoder/locations/addressbatch` | [doc, 02]: HTTP 200 x3 |
| Required params | `addressFile` (file), `benchmark`. `vintage` is required only for `returntype=geographies` | [doc]; calls with only benchmark worked [02] |
| `returntype` | `locations` = coordinates and matched address (all we need). `geographies` additionally returns state/county/tract/block GEOIDs (needs `vintage`); not used | [doc] |
| Benchmark | `Public_AR_Current` (id 4, `isDefault: true`); others: `Public_AR_ACS2026` (8), `Public_AR_LUCA` (11, also flagged default), `Public_AR_Census2020` (2020). Name or id both accepted | [ep] `/benchmarks`, `/vintages?benchmark=4` and `=Public_AR_Current` |
| Vintages (geographies only) | `Current_Current` (id 4, default), `Census2010_Current`, `Census2020_Current`, `ACS2017..ACS2026_Current` | [ep] |
| Single-address JSON | `result.addressMatches[]` with `matchedAddress`, `coordinates.x` (longitude), `coordinates.y` (latitude), `tigerLine.tigerLineId`, `tigerLine.side`, `addressComponents{fromAddress,toAddress,...}`. Empty `addressMatches` = no match | [ep] (e.g. `1200 12th Ave S, Seattle, WA 98144` -> x -122.317181, y 47.593912) |
| Batch max records | 10,000 per file [doc]; file size limit not documented. Largest tested: 2,000 rows (325 KB response) | [doc, 06] |
| Accepted file extensions | `.csv .txt .dat .xls .xlsx` [doc]; we sent `.csv`, no header row | [02] |

### Batch request file (no header row)
`Unique ID, Street address, City, State, ZIP` [doc]. Unique ID and street are required; missing parts stay as empty fields; fields containing commas must be quoted [doc]. Verified: blank ZIP matched Exact (`400 BROAD ST`, Seattle) and blank city matched Exact (`, , WA, 98109`) [05 probes]. ZIP+4 `98109-4610` matched but flagged Non_Exact with identical coordinates [05]. A wrong city (`TACOMA` with ZIP 98109) still matched at the correct location, flagged Non_Exact [05]. So ZIP carries most of the weight; city is weakly used.

### Batch response (CSV, no header, quoted, 8 columns on a match, only 3 on no-match/tie)
| # | Column | Notes |
|---|---|---|
| 1 | Unique ID | the id we sent |
| 2 | Input address | our 4 fields joined with `, `; a comma inside our street is NOT escaped, so do not parse this column |
| 3 | Match indicator | `Match`, `No_Match`, `Tie` [03: 474 / 23 / 3 in b1] |
| 4 | Match type | `Exact` or `Non_Exact`; **absent** (row has 3 fields) for `No_Match` and `Tie` |
| 5 | Matched address | normalised, upper-case, `STREET, CITY, WA, ZIP5`; the ZIP and street suffix may differ from input |
| 6 | Coordinates | one quoted field `"lon,lat"` (x first, then y), e.g. `"-122.270194076178,47.507753913038"` |
| 7 | TIGER/Line ID | edge id, e.g. `186626788` |
| 8 | Side | `L` or `R` of the street edge (237 / 237 in b1) |
Evidence: `grep`/`awk` on `data/batch1_output.csv`: 474 lines with 8 fields, 26 with 3 [02, 03]. A ragged CSV: parse with a reader that allows variable column counts (DuckDB needs `null_padding=true`, `auto_detect=false` with explicit delimiter/quote/escape or the sniffer fails) [03].

**Output row order is NOT the input order**: 1 of 500 ids was in the same position, but the id sets were identical [03, shell compare]. Always join on Unique ID.

## Keys
| Candidate key | Unique? | Null rate | Notes |
|---|---|---|---|
| Unique ID (our value) | yes, 500/500 and 2,000/2,000 [03, 07] | 0 | must be set by us; make it the address cache key (see below). Not required to be numeric: 16-hex md5 prefix worked |
| TIGER/Line ID | not unique (many addresses on one edge) | null on No_Match/Tie | not a key |
| matched_address | not unique | null on No_Match/Tie | normalised address |

## Columns that matter (after parsing)
| Column | Type | Null % (b3, 2,000 rows) | Example | Use |
|---|---|---|---|---|
| id | text | 0 | `9c394d58593ee60e` | address cache key |
| match | text | 0 | Match | quality; only `Match` has coordinates |
| match_type | text | 5.5 (No_Match 96 + Tie 13) | Exact | quality; Non_Exact is still a usable point |
| matched_address | text | 5.5 | `10359 51ST AVE S, TUKWILA, WA, 98178` | debug / ZIP of matched record |
| coords | text `lon,lat` | 5.5 | | split to `longitude`, `latitude` doubles |
| tiger_line_id, side | text | 5.5 | | optional |
Counts from [07]. Nothing like a confidence score, accuracy radius or geocode date is returned. We must add `requested_at`, `benchmark`, `run_id` ourselves.

## Entity-resolution fields
- Input comes from KC `address`, `city`, `zip_code` (see KC card): mixed case, unit after a comma (`10439 16TH AVE SW, C`) or ` STE`/`#`, 117 city spellings, 22 ZIP+4.
- The service echoes back a normalised matched address (upper case, standard suffixes). It can change the suffix (`INTERNATIONAL BLVD` ok; `RAILROAD AVE` -> `RAILROAD ST`; `AUBURN WAY S` -> `N`), so it is also usable for debug but must not replace our own normalisation.
- Only 1 of 157 Non_Exact matches in b3 changed the street number (`925 4TH` -> `925 4TH AVE` is a suffix repair); 18 of 1,891 matches (1.0%) returned a different ZIP than sent [07]. Non_Exact is mostly suffix/direction repairs plus unit/ZIP+4 noise.

## Real test results
Method: distinct (address, city, zip) from the 50,000-row KC sample, non-mobile only (9,487 distinct raw; 8,159 after stripping units and upper-casing) [06]. Seeded random draws (`setseed`) [01, 06].

| Batch | Input form | n | Exact | Non_Exact | Tie | No_Match | Matched (Exact+Non_Exact) | Time |
|---|---|---|---|---|---|---|---|---|
| b1 | as in KC (units included) | 500 | 356 (71.2%) | 118 (23.6%) | 3 (0.6%) | 23 (4.6%) | 474 = **94.8%** | 3.37 s |
| b3 | unit stripped, upper-cased | 2,000 | 1,734 (86.7%) | 157 (7.9%) | 13 (0.65%) | 96 (4.8%) | 1,891 = **94.55%** | 11.78 s |
| b2 | 213 mixed rows (see below) | 213 | | | | | | 1.79 s |
[03, 07, 02 timings]

### Does stripping unit/suite text help?
- **Matched rate: no.** b1 had 26 failures (23 No_Match, 3 Tie; 11 had unit text, 15 did not). Stripping the unit from the 11 recovered 0 (9 No_Match, 2 Tie) [05]. The 15 without unit text cannot be changed by stripping.
- **Match quality flag: yes.** 92 b1 rows were Non_Exact and had unit text: stripped, 82 became Exact and 10 stayed Non_Exact; **all 92 returned identical coordinates** [05]. The unit text does not move the point; it only turns Exact into Non_Exact. Rows with unit text: 17 Exact / 92 Non_Exact; without: 339 Exact / 26 Non_Exact [03].
- Inline `STE 100` (no comma) is also ignored by the matcher (`400 BROAD ST STE 100` -> Exact, same point as without) [05].
- Conclusion: strip units before sending (high confidence). Benefit is cleaner Exact/Non_Exact flag and, more importantly, dedupe: 9,487 raw -> 8,159 stripped addresses in the sample (14% fewer calls; 8,137 if keyed on street+ZIP only) [06, 08].

### Kinds of addresses that fail (b3, 109 failures of 2,000 = 5.45%) [07]
| Pattern | No_Match | Tie | Examples |
|---|---|---|---|
| Regular numbered street, valid-looking (new construction or TIGER range gap) | 56 | 5 | `90 YESLER WAY` 98104, `300 PETER KIRK LN`, `4989 LAKEMONT BLVD SE`, `7060 OBERTO DR` Kent, `9010 BOALCH RD SE` |
| Malls, villages, plazas, commons (private roads not in TIGER) | 22 | 8 | `1928 S COMMONS`, `1379 SOUTHCENTER MALL BLVD`, `1101 OUTLET COLLECTION WAY SW`, `4610 VILLAGE CT NE`, `575 BELLEVUE SQUARE` (Tie) |
| `INTERNATIONAL BLVD` / `TUKWILA INTERNATIONAL BLVD` SeaTac/Tukwila (renamed highway) | 13 | 0 | `18400 INTERNATIONAL BLVD` 98188, `15037 TUKWILLA INTERNATIONAL BLVD` (typo in KC) |
| No leading house number | 4 | 0 | e.g. airport/pass addresses |
| Highway with `US HWY`/`SR` text | 1 | 0 | |
Hyphenated or abbreviated road names (`23315 MV-BLACK DIAMOND RD SE`, `2115 BEL-RED RD`, `14450 WOODINVILLE-REDMOND RD NE`) also fail or go Non_Exact. b1 failures looked the same (malls: University Village, Bellevue Square, Kent Station, Outlet Collection; `1215 NORTH LANDING WAY`, `SNOQUALMIE PASS SUMMIT RD`) [03].
- Highway names: `15000 HWY 99` (synthetic probe) matched Non_Exact as `15000 STATE RTE 99, LYNNWOOD, 98087`; `SR 99 AND 200TH ST` (intersection) and `PO BOX 1234` and `MAIN ST` (no number) -> No_Match [05 probes, synthetic input, not KC data]. In KC data no PO boxes were seen among the failures; "malformed" input is rare (4 no-leading-number of 2,000) [07].
- Tie: 16 across b1+b3; the response has no coordinates. Ties are mostly multi-tenant malls and cases where the same range exists on two sides/segments.
- Failures are mostly **destination addresses** (malls, village centres, airport, new developments), which is a real loss for restaurants: these are where food halls and chains cluster. Stage and flag them as "no pin"; consider a later fallback (KC parcel centroid via `parcel_number` in the KC data, or the legacy business list `sgr5-u9rw` lat/long). Neither was tested here (low confidence it helps).

## Throughput and limits
- Measured: 500 rows in 3.4 s (6.7 ms/row), 213 in 1.8 s, 2,000 in 11.8 s (5.9 ms/row) [02]. No timeouts, no HTTP errors, no throttling over 3 calls spaced by a few minutes.
- Documented limit: 10,000 records per batch file [doc]. File size not documented.
- Full initial load: distinct stripped addresses should be about 8,200 to 9,500 for the full 12,356 businesses (sample of last 2 years has 8,159 non-mobile; the KC card counts 9,561 raw distinct addresses in the full data, mobile included). At about 6 ms/row: **roughly 50 to 60 s in a single batch call**, under the 10,000 cap. Extrapolated from 2,000 rows; a 10,000-row call was not tested (medium confidence). Safe design: chunks of 2,000 to 5,000 rows, sequential, 5 s pause, HTTP timeout 300 s, 3 retries with backoff.
- Daily incremental volume: new KC addresses per day should be single digits to low tens (about 60 to 150 new businesses a month per the KC card), a single call of a few hundred ms to seconds.
- Rate limits / usage policy: **none published** on the API page [doc] and none hit. Be polite (one call at a time). A generic "may be subject to limitations; may block" statement exists in the Census Data API terms (below). Low confidence on unwritten limits.
- Lambda: a whole initial load fits the 15 min limit comfortably.

## Stability
- Benchmark names are stable strings: `Public_AR_Current` (id 4) is a **rolling** benchmark; the name does not change when the address ranges are refreshed. Result drift over time is therefore possible and not visible in the name. Dated benchmarks (`Public_AR_ACS2026`, `Public_AR_Census2020`) are frozen alternatives [ep]. The list of benchmarks changes yearly (ACS2026 is new this year; the vintage list goes up to `ACS2026_Current`) [ep]. Cadence of `Current` refreshes: not documented, not observable in one day (low confidence).
- Recommendation: pin `Public_AR_Current` (matches the spec), record `benchmark` and `requested_at` per run in the raw manifest, and re-send previous `No_Match`/`Tie` rows every ~90 days because TIGER updates add new streets. Do not re-send successful matches.
- Determinism: 100 matched b1 rows (id-sorted first 100 Match rows) resubmitted minutes later returned identical match, match type, matched address, coordinates and TIGER ID for **100 of 100** [05]. Same-day only; across weeks unknown. Medium confidence.

## Terms
- The Geocoder page [doc] states no license, quota or storage restriction.
- Closest official text: Census Bureau Data API Terms of Service (https://www.census.gov/data/developers/about/terms-of-service.html, fetched 2026-11-12). It applies to the "Census Bureau Data API" (ACS, decennial etc.); whether the Geocoder is in scope is not stated. It says: services may be "subject to certain limitations on access, calls, or use" and abusive use may be blocked; apps using the API should display "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau"; you may not misrepresent the data while claiming Census as source; no restriction on storing; and a clause on not using data to identify "any person, household, business, or entity" (written for survey data; it does not apply to restaurant street addresses that we get from public KC records, but cite it, low confidence).
- Census data is a US federal government work (public domain, 17 USC 105; general knowledge, not on the fetched page, medium confidence). The Census open-data page states a commitment to open data but no explicit licence [fetched].
- Practical conclusion: storing the returned coordinates and matched address in S3/Snowflake and displaying map pins is allowed; unlike Google Places, there is no cache limit. Show an attribution line in the app footer ("Geocoding by US Census Bureau Geocoder; not endorsed by the Census Bureau"). Medium-low confidence; I did not read the Census Geocoder User Guide PDF (could not extract text).

## Quirks and traps
- **Output order differs from input order**; join on Unique ID only [03].
- **Ragged CSV**: no-match/tie rows have 3 fields, matches have 8; coordinates are one field `"lon,lat"` (longitude first, opposite to the usual lat,lon) [02, 03].
- **No header row** in request or response.
- **No coordinates on `Tie`** and none on `No_Match`; the spec's "null when unmatched" holds, but ties should be a distinct match status.
- Echoed input address (col 2) is unescaped and not reliably parseable; rely on id.
- Unit text does not change the coordinates but demotes Exact to Non_Exact [05]; so `match_type` is not a precision indicator. All matches are street-interpolated points (a mall with 100 tenants gets one point).
- Wrong city or missing ZIP still geocodes; 1.0% of matches return a different ZIP than sent [05, 07].
- Rolling `Current` benchmark: coordinates may shift slightly across refreshes; store `benchmark` and `requested_at`.
- Failures concentrate on malls, village centres, airport and renamed highways, i.e. exactly where multi-tenant food places are [07]. Expect roughly 5% of addresses and a higher share of food-hall candidates to have no pin.
- Geocode addresses per address, not per business: many businesses share one address (multi-tenant, KC card), and mobile units' `address` is a commissary, not a serving location, so **exclude `Mobile Food Unit` from the geocode input** (the profile used non-mobile only). Mobile units add about 345 addresses (KC card), mostly commissaries or stadiums.
- Spec impact (does not contradict the spec; additions): (1) the cache key must be built before dbt runs (inside the extractor), so the normalisation used for the key must be the same function as `int_addresses_normalized` or the key must be explicitly a simple, separate "geocode_key"; (2) "geocode all 12,356 business addresses" is really about 8.2k to 9.6k distinct addresses.

## Recommended request format and cache key
- Request: `POST /geocoder/locations/addressbatch`, form fields `addressFile=@file.csv` and `benchmark=Public_AR_Current`. CSV without header: `geocode_key, street_clean, city_upper, WA, zip5`; quote street and city (`force_quote`). Chunk size 2,000 to 5,000 (cap 10,000). Timeout 300 s, retry with backoff on non-200 or on row count mismatch.
- Street clean-up (matches the tested function [04, 06]): trim; drop everything after the first comma; drop trailing `#x`, `STE x`, `SUITE x`, `UNIT x`, `SPACE x`, `BLDG x`; upper-case; collapse whitespace. ZIP: first 5 digits. Do not rewrite suffixes (`SQ`, `BLVD`); the geocoder normalises these.
- **Cache key** `geocode_key = md5(street_clean || '|' || zip5)` (16 hex chars worked as Unique ID; use all 32 for lower collision risk). City is left out of the key because of the 117 spellings: street+ZIP gives 8,137 keys against 8,157 for street+city+ZIP in the sample [08], and the geocoder barely uses city [05]. Send the city of the first row seen for that key.
- "Already geocoded" = key present in any previous raw response file (read the Unique ID column of earlier `raw/census_geocoder/` files, or a small key index file written by the extractor). `No_Match`/`Tie` also count as geocoded (to avoid resending 5% forever), and are retried when older than 90 days. The extractor takes the distinct keys from the latest `raw/kc_inspections_current/` file, excludes mobile units, and sends only unseen keys.
- Landing (as-received): `s3://<bucket>/raw/census_geocoder/dt=YYYY-MM-DD/<run_id>.csv` = the response bytes unchanged (one file per chunk with `<run_id>_<chunk>.csv`), plus a sidecar `<run_id>.manifest.json` (benchmark, requested_at, row counts sent/received, HTTP status, elapsed s) and `<run_id>.request.csv` (the file sent, so that input street/city/zip are recoverable; the echo in column 2 is not parseable). Idempotent per run date: same keys, same files. If no new keys, land nothing (or an empty manifest) and log 0 rows.

## Proposed staging model
`stg_census__geocodes`: **grain one row per geocode_key per geocode request (latest request wins in the model after dedupe)**; staging parses and types, dedupe to latest `requested_at` per `geocode_key` (a key can be re-sent after a No_Match retry).
| Column | Source | Cast |
|---|---|---|
| geocode_key | col 1 | varchar |
| match_status | col 3 (`Match`/`No_Match`/`Tie` -> lowercase `match`, `no_match`, `tie`) | varchar |
| match_type | col 4, null unless match (`exact`/`non_exact`) | varchar |
| matched_address | col 5 | varchar |
| longitude | split col 6 on `,` first part | double |
| latitude | split col 6 second part | double |
| tiger_line_id | col 7 | varchar |
| tiger_side | col 8 | varchar (L/R) |
| benchmark, requested_at, run_id, source_file | manifest / file path | varchar, timestamp |
Primary key: `geocode_key` (after dedupe). Parse the 3- vs 8-column rows with a ragged-tolerant COPY INTO (Snowflake `ERROR_ON_COLUMN_COUNT_MISMATCH = false`) or by landing the response into a single VARCHAR column and splitting in staging (recommended; keeps raw as-is). `int_address_geocodes` joins to `int_addresses_normalized` on the same key logic and nulls lat/long unless `match_status = 'match'`.

## Proposed tests
- `unique`, `not_null` on `stg_census__geocodes.geocode_key`.
- `accepted_values` on `match_status` (`match`, `no_match`, `tie`) and `match_type` (`exact`, `non_exact`, null).
- Coordinates not null iff `match_status = 'match'` (custom test); longitude between -122.6 and -121.0 and latitude between 47.0 and 47.8 (warn; all 2,365 tested matched points were inside) [03, 07].
- Relationship: every distinct geocode key in non-mobile KC establishments exists in the geocodes (warn: unmatched share below 8%; observed 5.5% of addresses unmatched).
- Freshness: latest `requested_at` within 14 days (warn) is not meaningful when nothing is new; test instead that no key has `requested_at` older than 120 days while status is not `match`.
- Row-count: rows received equals rows sent per manifest.
