#!/usr/bin/env bash
# usage: 02_submit_batch.sh <input.csv> <output.csv> [benchmark]  (one call; prints time and HTTP code)
set -euo pipefail
curl -sS --max-time 600 --form addressFile=@"$1" --form benchmark="${3:-Public_AR_Current}" \
  -w 'http=%{http_code} time_total=%{time_total}s size=%{size_download}\n' \
  -o "$2" https://geocoding.geo.census.gov/geocoder/locations/addressbatch
