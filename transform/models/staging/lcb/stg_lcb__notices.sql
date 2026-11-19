-- One row per licence notice across all daily snapshots: the latest snapshot's values, plus
-- the first and last snapshot it appeared in. Personal fields (contact, phones, applicants,
-- signee, mailing address) are never selected. licensee_name (the company on the licence,
-- sometimes a sole proprietor) is kept for matching to KC only and must never be exported
-- (owner decision 2026-11-19; test no_licensee_name_in_marts).
with raw as (
    select json, filename from {{ source('lcb', 'notices_raw') }}
),

typed as (
    select
        json ->> 'license'                                            as license_number,
        json ->> 'l_a_type'                                           as notice_type,
        cast(strptime(json ->> 'applicationdate', '%Y%m%d') as date)  as application_date,
        cast(json ->> 'la_posted_date' as date)                       as posted_date,
        json ->> 'tradename'                                          as trade_name,
        json ->> 'licenseename'                                       as licensee_name,
        json ->> 'ubi'                                                as ubi,
        json ->> 'streetaddress'                                      as street_address,
        json ->> 'city'                                               as city,
        left(json ->> 'zipcode', 5)                                   as zip5,
        json ->> 'countyname'                                         as county,
        list_filter(
            [json ->> 'privdesc01', json ->> 'privdesc02', json ->> 'privdesc03', json ->> 'privdesc04',
             json ->> 'privdesc05', json ->> 'privdesc06', json ->> 'privdesc07'],
            lambda p: p is not null
        )                                                             as privileges,
        json ->> 'corrected_amended'                                  as corrected_amended,
        cast(regexp_extract(filename, 'dt=([0-9]{4}-[0-9]{2}-[0-9]{2})', 1) as date) as snapshot_date,
        filename                                                      as source_file
    from raw
),

seen as (
    select
        license_number,
        notice_type,
        application_date,
        min(snapshot_date) as first_seen_on,
        max(snapshot_date) as last_seen_on
    from typed
    group by all
),

latest as (
    select * exclude (recency)
    from (
        select
            *,
            row_number() over (
                partition by license_number, notice_type, application_date
                order by snapshot_date desc, source_file desc
            ) as recency
        from typed
    )
    where recency = 1
)

select
    license_number || '|' || notice_type || '|' || strftime(application_date, '%Y%m%d') as notice_id,
    latest.license_number,
    latest.notice_type,
    latest.application_date,
    latest.posted_date,
    latest.trade_name,
    latest.licensee_name,
    latest.ubi,
    latest.street_address,
    latest.city,
    latest.zip5,
    latest.county,
    latest.privileges,
    latest.corrected_amended,
    seen.first_seen_on,
    seen.last_seen_on
from latest
join seen using (license_number, notice_type, application_date)
