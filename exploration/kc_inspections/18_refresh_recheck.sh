#!/usr/bin/env bash
# Re-run cheap totals + system-field queries to compare with the first pull (observed cadence).
source "$(dirname "$0")/lib.sh"
soql r878-4sxa recheck_totals --data-urlencode '$select=count(*) as n_rows, max(inspection_date) as max_date, max(:updated_at) as max_upd, min(:updated_at) as min_upd, max(:created_at) as max_cr'
curl -sS -m 60 "https://data.kingcounty.gov/api/views/r878-4sxa.json" | "$DUCKDB" -noheader -list -c "select rowsUpdatedAt, viewLastModified from read_json_auto('/dev/stdin')"
cat "$DATA/agg/recheck_totals.json"; echo
