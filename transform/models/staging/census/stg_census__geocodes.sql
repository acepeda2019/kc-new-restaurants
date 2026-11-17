-- Latest geocoder response per address key. A response's time comes from its chunk record
-- (requested_at); a response without one falls back to the dt= date in its path.
with responses as (
    select
        geocode_key,
        match_status,
        match_type,
        matched_address,
        lon_lat,
        tiger_line_id,
        side,
        filename,
        regexp_extract(filename, 'census_geocoder/.*$')                         as response_path,
        cast(regexp_extract(filename, 'dt=(\d{4}-\d{2}-\d{2})', 1) as timestamp) as dt_date
    from {{ source('census', 'geocoder_responses') }}
),

chunks as (
    select
        regexp_extract(json ->> 'response_key', 'census_geocoder/.*$') as response_path,
        cast(json ->> 'requested_at' as timestamp)                     as requested_at,
        json ->> 'benchmark'                                           as benchmark
    from {{ source('census', 'geocoder_chunks') }}
),

ranked as (
    select
        responses.*,
        coalesce(chunks.requested_at, responses.dt_date) as requested_at,
        chunks.benchmark,
        row_number() over (
            partition by responses.geocode_key
            order by coalesce(chunks.requested_at, responses.dt_date) desc, responses.filename desc
        ) as recency
    from responses
    left join chunks using (response_path)
)

select
    geocode_key,
    match_status,
    match_type,
    matched_address,
    case when match_status = 'Match' then cast(split_part(lon_lat, ',', 2) as double) end as latitude,
    case when match_status = 'Match' then cast(split_part(lon_lat, ',', 1) as double) end as longitude,
    tiger_line_id,
    side,
    benchmark,
    requested_at,
    filename as source_file
from ranked
where recency = 1
