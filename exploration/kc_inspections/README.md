# KC inspections profiling scripts

Run from this folder; `data/` is git-ignored (83 MB). Order: `00_metadata.sh`, `01_current_aggregates.sh`, `03_legacy_derived.sh`, `04_cur_sample.sh`,
then the `.sql` files with `cd data && duckdb -f ../NN_name.sql`. Script numbers are cited in `docs/source_cards/kc_inspections_*.md`.
Gap at 02: the earlier combined sample script was removed (superseded by 03 and 04).
Gotcha: in DuckDB `~` is a FULL-string regex match; use `regexp_matches()` for substring tests.
