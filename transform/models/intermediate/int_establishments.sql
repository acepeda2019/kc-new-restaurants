with violations as (
    select * from {{ ref('stg_kc__inspection_violations') }}
),

inspections as (
    select * from {{ ref('stg_kc__inspections') }}
),

rules as (
    select * from {{ ref('classification_rules') }}
),

venues as (
    select * from {{ ref('venue_exclusions') }}
),

geocodes as (
    select * from {{ ref('stg_census__geocodes') }}
),

pulled as (
    select cast(regexp_extract(max(source_file), 'dt=(\d{4}-\d{2}-\d{2})', 1) as date) as pulled_on
    from violations
),

-- KC business attributes are constant per business_id (source card), so any row will do.
businesses as (
    select
        business_id,
        any_value(business_name)      as business_name,
        any_value(program_identifier) as program_identifier,
        any_value(classification)     as classification,
        any_value(address)            as address,
        any_value(city)               as city,
        any_value(zip_code)           as zip_code
    from violations
    group by business_id
),

-- Canonical geocode key rule v1 (ingestion/sources/geocode_key.py); tested against the
-- keys the geocoder was actually sent (tests/assert_geocode_key_matches_requests.sql).
keyed as (
    select
        *,
        trim(regexp_replace(
            trim(regexp_replace(split_part(upper(coalesce(address, '')), ',', 1), '[ \t\n\r\f\v]+', ' ', 'g')),
            ' (#|STE\.) ?[^ ]+$| (STE|SUITE|UNIT|SPACE|BLDG) [^ ]+$', ''
        ))                                                                as street_clean,
        left(trim(coalesce(zip_code, '')), 5)                            as zip5,
        trim(regexp_replace(upper(coalesce(city, '')), '[ \t\n\r\f\v]+', ' ', 'g')) as city_normalized
    from businesses
),

inspection_summary as (
    select
        business_id,
        count(*)                                                                   as inspection_count,
        arg_min(inspection_date, (inspection_date, inspection_serial_num))         as first_inspection_date,
        arg_min(inspection_type, (inspection_date, inspection_serial_num))         as first_inspection_type,
        arg_min(inspection_result, (inspection_date, inspection_serial_num))       as first_inspection_result,
        arg_min(red_points, (inspection_date, inspection_serial_num))              as first_inspection_red_points,
        arg_max(inspection_date, (inspection_date, inspection_serial_num))         as latest_inspection_date,
        arg_max(inspection_result, (inspection_date, inspection_serial_num))       as latest_inspection_result,
        arg_max(red_points, (inspection_date, inspection_serial_num))              as latest_red_points,
        arg_max(is_closed_by_inspection, (inspection_date, inspection_serial_num)) as is_closed_by_latest_inspection
    from inspections
    group by business_id
),

joined as (
    select
        keyed.business_id,
        keyed.business_name,
        keyed.program_identifier,
        keyed.classification,
        rules.rule_category,
        keyed.address,
        keyed.city_normalized,
        keyed.zip5,
        case when keyed.street_clean <> '' then md5(keyed.street_clean || '|' || keyed.zip5) end as geocode_key,
        inspection_summary.* exclude (business_id),
        pulled.pulled_on
    from keyed
    join inspection_summary using (business_id)
    left join rules using (classification)
    cross join pulled
)

select
    joined.*,
    case when joined.classification <> 'Mobile Food Unit' then geocodes.latitude end  as latitude,
    case when joined.classification <> 'Mobile Food Unit' then geocodes.longitude end as longitude,
    geocodes.match_status                                                             as geocode_match_status,
    venues.venue_name is not null                                                     as is_venue_excluded,
    count(*) filter (where joined.latest_inspection_date >= joined.pulled_on - interval 365 day)
        over (partition by joined.geocode_key)                                        as businesses_at_address
from joined
left join geocodes using (geocode_key)
left join venues using (geocode_key)
