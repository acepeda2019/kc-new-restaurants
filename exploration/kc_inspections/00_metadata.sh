#!/usr/bin/env bash
# Portal metadata + catalog search. Confirms dataset IDs, license, schema.
source "$(dirname "$0")/lib.sh"
for id in r878-4sxa f29f-zza5 sgr5-u9rw 29us-kypr mzbk-wwns; do
  curl -sS --max-time 60 -o "$DATA/meta/views_$id.json" -w "views $id HTTP %{http_code}\n" "https://data.kingcounty.gov/api/views/$id.json"; sleep 1
done
# legacy row endpoint + CSV export (expect 403 = private)
curl -sS --max-time 60 -o "$DATA/meta/legacy_resource_probe.json" -w "resource f29f-zza5 HTTP %{http_code}\n" "$BASE/f29f-zza5.json?\$limit=1"; sleep 1
curl -sS --max-time 60 -o "$DATA/meta/legacy_csv_probe.txt" -w "rows.csv f29f-zza5 HTTP %{http_code}\n" "https://data.kingcounty.gov/api/views/f29f-zza5/rows.csv?accessType=DOWNLOAD"; sleep 1
curl -sS --max-time 60 -o "$DATA/meta/catalog_kc.json" "https://data.kingcounty.gov/api/catalog/v1?domains=data.kingcounty.gov&search_context=data.kingcounty.gov&q=food%20inspection&limit=50"; sleep 1
curl -sS --max-time 60 -o "$DATA/meta/catalog_kc_food.json" "https://data.kingcounty.gov/api/catalog/v1?domains=data.kingcounty.gov&search_context=data.kingcounty.gov&q=food&only=datasets&limit=50"; sleep 1
curl -sS --max-time 60 -o "$DATA/meta/derived_f29f.json" "https://data.kingcounty.gov/api/catalog/v1?derived_from=f29f-zza5&limit=100"
