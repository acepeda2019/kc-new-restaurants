#!/usr/bin/env bash
# 50,000 most recent rows of current dataset with system fields (atomic write).
source "$(dirname "$0")/lib.sh"
curl -fsS -G --max-time 300 --retry 3 -o "$DATA/sample/cur_recent_50k.tmp" "$BASE/r878-4sxa.json" \
  --data-urlencode '$select=:*,*' --data-urlencode '$order=inspection_date desc, inspection_serial_num, :id' --data-urlencode '$limit=50000'
mv "$DATA/sample/cur_recent_50k.tmp" "$DATA/sample/cur_recent_50k.json"
"$DUCKDB" -noheader -list -c "select count(*) from read_json_auto('$DATA/sample/cur_recent_50k.json')"
