-- Rows of the latest KC pull only (the newest dt=, then the newest run_id). Each pull is the
-- whole dataset, so older files are history for replays, not data to union.
with raw as (
    select json, filename from {{ source('kc', 'inspections_raw') }}
),

latest_file as (
    select max(filename) as filename from raw
),

latest as (
    select raw.json, raw.filename
    from raw
    join latest_file using (filename)
)

select
    md5(
        (json ->> 'inspection_serial_num') || '|' || coalesce(json ->> 'violation_description', '')
    )                                                              as violation_key,
    json ->> 'inspection_serial_num'                               as inspection_serial_num,
    json ->> 'business_id'                                         as business_id,
    json ->> 'name'                                                as business_name,
    json ->> 'program_identifier'                                  as program_identifier,
    json ->> 'classification'                                      as classification,
    json ->> 'address'                                             as address,
    json ->> 'city'                                                as city,
    json ->> 'zip_code'                                            as zip_code,
    cast(json ->> 'inspection_date' as date)                       as inspection_date,
    json ->> 'inspection_type'                                     as inspection_type,
    try_cast(json ->> 'inspection_score' as decimal(6, 2))         as inspection_score,
    json ->> 'inspection_result'                                   as inspection_result,
    (json ->> 'inspection_closed_business') = 'Yes'                as is_closed_by_inspection,
    json ->> 'seating_range'                                       as seating_range,
    json ->> 'risk_category'                                       as risk_category,
    json ->> 'grade'                                               as grade,
    json ->> 'parcel_number'                                       as parcel_number,
    json ->> 'violation_type'                                      as violation_type,
    json ->> 'violation_description'                               as violation_description,
    coalesce(try_cast(json ->> 'violation_points' as integer), 0)  as violation_points,
    filename                                                       as source_file
from latest
