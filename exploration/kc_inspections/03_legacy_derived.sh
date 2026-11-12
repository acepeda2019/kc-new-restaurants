#!/usr/bin/env bash
# Pull the public derived views of the private legacy dataset f29f-zza5 (all rows, <50k each).
source "$(dirname "$0")/lib.sh"
for p in "29us-kypr legacy_safeway_filter_29us-kypr" "sgr5-u9rw legacy_businesses_sgr5-u9rw" "j2pu-r4ru legacy_food_establishments_j2pu-r4ru" "mzbk-wwns legacy_safeway_byname_mzbk-wwns"; do
  set -- $p
  curl -sS -G --max-time 300 -o "$DATA/sample/$2.json" "$BASE/$1.json" --data-urlencode '$select=:*,*' --data-urlencode '$limit=50000'; sleep 2
  echo "$2: $("$DUCKDB" -noheader -list -c "select count(*) from read_json_auto('$DATA/sample/$2.json')")"
done
# Current rows for the same Safeway/Albertsons names (cross-dataset key comparison)
curl -sS -G --max-time 300 -o "$DATA/sample/cur_safeway_albertsons.json" "$BASE/r878-4sxa.json" --data-urlencode '$select=:*,*' --data-urlencode "\$where=upper(name) like '%SAFEWAY%' or upper(name) like '%ALBERTSON%'" --data-urlencode '$limit=50000'
