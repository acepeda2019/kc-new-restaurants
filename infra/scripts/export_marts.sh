#!/usr/bin/env bash
# Export app marts to JSON and publish them to exports/latest/.
#
#   1. COPY INTO the exports stage: exports/dt=<RUN_DATE>/<RUN_ID>/<mart>.json
#      (newline-delimited JSON, one object per row)
#   2. Check rows_unloaded == count(*) >= MIN_ROWS for every mart
#   3. Re-count the dated files in S3 against the manifest
#   4. Promote: sync the dated folder to exports/latest/, then write
#      exports/latest/manifest.json (built_at, row counts, schema version)
#   5. Re-count exports/latest/ against the manifest
# Any mismatch exits non-zero, so the Vercel deploy hook is never called.
#
# Required env: DATA_BUCKET, RUN_DATE, RUN_ID, EXPORT_MARTS (space-separated
# mart names in MARTS), EXPORT_SCHEMA_VERSION, plus the snow.sh variables
# with SNOWFLAKE_ROLE set to the transformer role.
# Optional env: MIN_ROWS (default 1), GITHUB_SHA.
set -euo pipefail

: "${DATA_BUCKET:?}" "${RUN_DATE:?}" "${RUN_ID:?}" "${EXPORT_MARTS:?}"
: "${EXPORT_SCHEMA_VERSION:?}" "${SNOWFLAKE_DATABASE:?}"
MIN_ROWS="${MIN_ROWS:-1}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
snow_sql="$here/snow.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

[[ "$RUN_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Bad RUN_DATE" >&2; exit 1; }
[[ "$RUN_ID" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Bad RUN_ID" >&2; exit 1; }

dated_rel="dt=${RUN_DATE}/${RUN_ID}"
dated_s3="s3://${DATA_BUCKET}/exports/${dated_rel}"
latest_s3="s3://${DATA_BUCKET}/exports/latest"
stage="@${SNOWFLAKE_DATABASE}.MARTS.EXPORTS_S3_STAGE"

# First value of a case-insensitive column from `snow sql --format json`.
json_col() {
  jq -r --arg c "$1" '
    (if (.[0] | type) == "array" then .[-1] else . end)
    | .[0] | to_entries[] | select(.key | ascii_downcase == $c) | .value'
}

# Number of JSON records in an NDJSON file.
count_records() {
  jq -s 'length' "$1"
}

counts_json='{}'
for mart in $EXPORT_MARTS; do
  [[ "$mart" =~ ^[a-z][a-z0-9_]*$ ]] || { echo "Bad mart name: $mart" >&2; exit 1; }
  table="${SNOWFLAKE_DATABASE}.MARTS.${mart}"

  expected="$("$snow_sql" --format json -q "select count(*) as n from ${table}" | json_col n)"
  unloaded="$("$snow_sql" --format json -q "
    copy into ${stage}/${dated_rel}/${mart}.json
    from (select object_construct_keep_null(*) from ${table})
    file_format = (type = json compression = none)
    single = true
    overwrite = true
    max_file_size = 104857600" | json_col rows_unloaded)"

  echo "${mart}: count=${expected} unloaded=${unloaded}"
  if [[ "$unloaded" != "$expected" ]]; then
    echo "Row count mismatch for ${mart}" >&2; exit 1
  fi
  if (( expected < MIN_ROWS )); then
    echo "${mart} has ${expected} rows (< ${MIN_ROWS}); refusing to publish" >&2; exit 1
  fi
  counts_json="$(jq -c --arg m "$mart" --argjson n "$expected" '. + {($m): $n}' <<<"$counts_json")"
done

jq -n \
  --arg built_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg run_date "$RUN_DATE" \
  --arg run_id "$RUN_ID" \
  --arg git_sha "${GITHUB_SHA:-unknown}" \
  --arg source "exports/${dated_rel}/" \
  --arg schema_version "$EXPORT_SCHEMA_VERSION" \
  --argjson row_counts "$counts_json" \
  '{schema_version: $schema_version, built_at: $built_at, run_date: $run_date,
    run_id: $run_id, git_sha: $git_sha, source_export: $source,
    row_counts: $row_counts}' > "$work/manifest.json"

verify_prefix() {
  local prefix="$1"
  for mart in $EXPORT_MARTS; do
    aws s3 cp --only-show-errors "${prefix}/${mart}.json" "$work/check.json"
    local got want
    got="$(count_records "$work/check.json")"
    want="$(jq -r --arg m "$mart" '.row_counts[$m]' "$work/manifest.json")"
    if [[ "$got" != "$want" ]]; then
      echo "${prefix}/${mart}.json has ${got} records, manifest says ${want}" >&2; exit 1
    fi
  done
}

verify_prefix "$dated_s3"

aws s3 sync --only-show-errors --delete --exclude manifest.json "$dated_s3/" "$latest_s3/"
aws s3 cp --only-show-errors \
  --content-type application/json \
  --cache-control no-cache \
  "$work/manifest.json" "$latest_s3/manifest.json"

verify_prefix "$latest_s3"
echo "Published ${dated_rel} to exports/latest/"
