# Source card: <source name>

- **Owner / publisher:**
- **Access:** API endpoint, export URL, auth (none / app token)
- **License / terms:** what we may store and display
- **Refresh cadence observed:** (from profiling, not the portal's claim)
- **Coverage:** date range, geography
- **Profiled on:** YYYY-MM-DD, sample size N

## Grain
One row per ___. Evidence: ___ (query + result).

## Keys
| Candidate key | Unique? | Null rate | Notes |
|---|---|---|---|

## Columns that matter
| Column | Type | Null % | Distinct | Example | Use |
|---|---|---|---|---|---|

## Entity-resolution fields
Name, address, ZIP, lat/long, UBI, license number: format, messiness, examples.

## Quirks and traps
- 

## Proposed staging model
`stg_<source>__<entity>`: renames, casts, dedupe rule, primary key.

## Proposed tests
- 
