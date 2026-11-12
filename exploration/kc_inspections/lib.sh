#!/usr/bin/env bash
# Shared helpers for KC inspections profiling. Source this file.
# soql <dataset_id> <out_name> [--data-urlencode '$param=value' ...]
# Writes data/agg/<out_name>.json and prints row count. Polite: 1s sleep, 120s timeout, 3 retries.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$HERE/data"
DUCKDB="${DUCKDB:-/Users/acepeda/.local/bin/duckdb}"
BASE="https://data.kingcounty.gov/resource"
mkdir -p "$DATA/agg" "$DATA/sample" "$DATA/meta"

soql() {
  local id="$1" out="$2"; shift 2
  local f="$DATA/agg/$out.json"
  curl -sS -G --max-time 120 --retry 3 --retry-delay 5 -o "$f" "$BASE/$id.json" "$@"
  sleep 1
  if head -c 20 "$f" | grep -q '"error\|"message'; then echo "ERROR $out: $(head -c 300 "$f")" >&2; return 1; fi
  echo "$out: $("$DUCKDB" -noheader -list -c "select count(*) from read_json_auto('$f')" 2>/dev/null || echo '?') rows"
}
