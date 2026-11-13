# Test fixtures (recorded, real data)

All files are cut from real responses recorded on 2026-11-12; nothing is invented.

| File | Recorded from |
|---|---|
| `kc_page_offset0.json`, `kc_page_offset3.json` | Socrata `r878-4sxa.json?$limit=3&$order=:id` at `$offset` 0 and 3 |
| `kc_page_offset6.json` | same with `$offset=6`, cut to its first row so the test "dataset" has 7 rows |
| `kc_rows_tricky.jsonl` | Socrata `$where=address in (...)` for addresses with units, ZIP+4, mobile units, a tie and a no-match; at most 2 rows per (address, city, zip, classification) |
| `geocoder_request.csv` | built by `census_geocoder.build_request_csv` from `kc_rows_tricky.jsonl`; this exact file was sent |
| `geocoder_response.csv` | the Census `addressbatch` response to `geocoder_request.csv` (benchmark `Public_AR_Current`), unchanged |
| `geocoder_response_profiling_cut.csv` | 7 lines of `exploration/census_geocoder/data/batch1_output.csv` (profiling batch 1; ids use the profiling key, not the v1 cache key) |

The KC row count (7) used by the paging tests matches the cut pages; the real dataset had
111,644 rows. The `X-SODA2-Truth-Last-Modified` value in the tests is the real header value.
