# Sample raw data (real, small)

**Sample data.** A small cut of the real raw layer, laid out exactly like `s3://<bucket>/raw/`, so
dbt runs locally with no AWS access: `uv run --python 3.12 dbt build --vars '{raw_root: data/sample/raw}'`.
Nothing is invented.

- `kc_inspections/dt=2026-11-17/…jsonl.gz`: all 104 rows of 29 real businesses from the public KC
  dataset (`r878-4sxa`, pulled 2026-11-17), written the way the extractor writes them. Chosen to
  cover: new openings (incl. one with a failed first inspection), new concepts with the business
  each replaced, ownership transfers (new and old id), food trucks, a standalone bakery, a coffee
  stand, a grocery store, a school, a stadium vendor, an airport vendor, a business closed by an
  inspection, and an older restaurant.
- `census_geocoder/dt=2026-11-17/…/`: the real Census geocoder run for those addresses, produced by
  `ingestion/sources/census_geocoder.py` against a mocked bucket (21 addresses, all matched).
- `census_geocoder/dt=2026-11-12/…/`: the recorded fixture request/response from
  `ingestion/tests/fixtures/` (includes `Tie` and `No_Match` lines; no chunk record, so the run date
  comes from `dt=`).
- `claude_classifications/dt=2026-11-17/…jsonl.gz`: **hand-labelled, not API output**
  (`model: "sample-hand-labelled"`): 18 of the 19 candidates, labelled from their KC records so the
  marts have input before the first live Haiku run. `input_hash` comes from the real code. One
  candidate is left unclassified and one is below 0.8, so the review list has entries.
- `lcb_local_authority/dt=2026-11-19/…jsonl.gz`: the real WSLCB notice snapshot landed by the daily
  job on 2026-11-19 (14 notices statewide, 7 King County), with personal fields (`contact`,
  `dayphone`, `applicants`, `designatedsignee`, `licenseename`, `mailaddress`, `mailcity`,
  `mailzip`) replaced by `SAMPLE …` values. Business fields are as received.
