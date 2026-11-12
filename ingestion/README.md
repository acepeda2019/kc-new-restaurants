# Ingestion (extract layer)

Python 3.12 extractors run as AWS Lambda functions by the Step Functions workflow
(`KC inspections -> Census geocoder -> GitHub dispatch`). They only extract: data lands in S3
`raw/` exactly as received. Cleaning, typing and renaming are dbt's job.

| Module | Handler string | Reads | Writes |
|---|---|---|---|
| `sources/kc_inspections.py` | `handlers.kc_inspections.handler` | Socrata `r878-4sxa` | `raw/kc_inspections/dt=YYYY-MM-DD/<run_id>.jsonl.gz` |
| `sources/census_geocoder.py` | `handlers.census_geocoder.handler` | `raw/kc_inspections/`, `raw/census_geocoder/` | `raw/census_geocoder/dt=YYYY-MM-DD/<run_id>/{request,response}_NNNN.csv`, `manifest.json` |
| `sources/dispatch.py` | `handlers.dispatch.handler` | Secrets Manager | GitHub `repository_dispatch` (`pipeline_run`) |
| `sources/geocode_key.py` | (library) | | canonical `geocode_key` rule; **dbt must reproduce it** |

## Contract with the workflow

Environment: `RAW_BUCKET` (required for KC and geocoder), `SOCRATA_APP_TOKEN` (optional),
`GITHUB_REPO` (`owner/name`) and `GITHUB_TOKEN_SECRET_ARN` (dispatch), `LOG_LEVEL` (default INFO).

Each handler returns a result dict and raises on failure:
`{source, status, run_date, run_id, rows, s3_keys, bucket, ...}` with `status` in
`succeeded | skipped_existing`. Event inputs:

- KC: optional `{"run_date": "YYYY-MM-DD", "run_id": "...", "force": false}`; `run_date` defaults
  to today in America/Los_Angeles.
- Geocoder: the KC result (optionally wrapped as `{"kc_inspections": <result>}`); it reuses the
  KC `run_id` and `run_date`.
- Dispatch: `[kc_result, geocoder_result]`, `{"results": [...]}` or
  `{"kc_inspections": ..., "census_geocoder": ...}`. It refuses to dispatch unless both are OK.

Dispatch `client_payload`: `run_date`, `run_id`, `s3_keys` and `rows` and `statuses` per source.

## Behaviour worth knowing

- **KC full pull every run** (`:updated_at` is one value for all rows). Pages of 50,000 by
  `$limit`/`$offset` with `$order=:id`; the row count and `X-SODA2-Truth-Last-Modified` header are
  checked so a mid-pull republish fails the run. Rows are written one JSON object per line as
  received (gzip, deterministic bytes).
- **Idempotent per run date:** a KC re-run for a date that already has a file returns it
  (`skipped_existing`) without calling Socrata; `force: true` lands a second file and never
  overwrites. The geocoder only sends keys without a prior response, so re-runs send nothing.
- **Geocoder skip rule:** `Match` is never re-sent; `No_Match`/`Tie` are re-sent once their latest
  request is 90+ days old. Mobile Food Units are excluded (their address is a commissary).
  Chunks of at most 5,000, one call at a time, 5 s apart; a response must echo every request id
  (output order is not input order) or the chunk is re-sent, up to 3 times.
- **dbt loading:** responses are ragged CSV (8 fields on Match, 3 otherwise; coordinates are one
  `"lon,lat"` field). Load `response_*.csv` as one VARCHAR column per line and split in staging;
  join manifests for `requested_at` and `benchmark`. `request_*.csv` holds the street/city/ZIP sent.
- Retries: timeouts, connection errors, 408/425/429/5xx with exponential backoff (honours
  `Retry-After`); other 4xx fail immediately.
- Logs are JSON lines (`event`, `source`, `page`, `rows`, `bytes`, `s3_keys`, ...).

## Develop

```bash
cd ingestion
uv sync
uv run ruff check . && uv run ruff format --check .
uv run pytest            # no network: HTTP is mocked with recorded fixtures, AWS with moto
./build.sh               # -> dist/lambda.zip (LAMBDA_ARCH=aarch64 for Graviton)
```

Fixtures in `tests/fixtures/` are cut from real responses; see `tests/fixtures/README.md`.
