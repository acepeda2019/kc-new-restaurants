-- Load new raw files from the S3 raw stage into RAW. Run by
-- .github/workflows/pipeline.yml as the loader role, before dbt.
-- Idempotent: Snowflake's load metadata (64 days) skips files already loaded.
-- Rendered with envsubst; the only placeholder is SNOWFLAKE_DATABASE.
-- Tables are as-received plus file metadata; dbt staging does the rest.

use schema ${SNOWFLAKE_DATABASE}.RAW;

-- KC food inspections (r878-4sxa): one JSON object per line, full pull per run.
-- Path contract: raw/kc_inspections/dt=YYYY-MM-DD/<run_id>.jsonl[.gz]
create table if not exists KC_INSPECTIONS (
    record                     variant,
    _source_file               varchar,
    _source_file_row           number,
    _source_file_last_modified timestamp_ntz,
    _loaded_at                 timestamp_ltz default current_timestamp()
);

copy into KC_INSPECTIONS (record, _source_file, _source_file_row, _source_file_last_modified)
from (
    select
        $1,
        metadata$filename,
        metadata$file_row_number,
        metadata$file_last_modified
    from @RAW_S3_STAGE/kc_inspections/
)
file_format = (format_name = 'JSONL')
pattern = '.*[.]jsonl([.]gz)?'
on_error = abort_statement;

-- Census batch geocoder responses: CSV, no header, ragged (8 or 3 fields).
-- Only the response chunks (<run_id>_<chunk>.csv) are loaded; the
-- .request.csv and .manifest.json sidecars are skipped by the pattern.
-- Path contract: raw/census_geocoder/dt=YYYY-MM-DD/<run_id>_<chunk>.csv
create table if not exists CENSUS_GEOCODER (
    col_1                      varchar,  -- unique id (geocode_key)
    col_2                      varchar,  -- input address echo (do not parse)
    col_3                      varchar,  -- match flag
    col_4                      varchar,  -- match type
    col_5                      varchar,  -- matched address
    col_6                      varchar,  -- "lon,lat"
    col_7                      varchar,  -- TIGER line id
    col_8                      varchar,  -- side
    _source_file               varchar,
    _source_file_row           number,
    _source_file_last_modified timestamp_ntz,
    _loaded_at                 timestamp_ltz default current_timestamp()
);

copy into CENSUS_GEOCODER (
    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8,
    _source_file, _source_file_row, _source_file_last_modified
)
from (
    select
        $1, $2, $3, $4, $5, $6, $7, $8,
        metadata$filename,
        metadata$file_row_number,
        metadata$file_last_modified
    from @RAW_S3_STAGE/census_geocoder/
)
file_format = (format_name = 'GEOCODER_CSV')
pattern = '.*_[0-9]+[.]csv'
on_error = abort_statement;
