with raw as (
    select json, filename from {{ source('claude', 'classifications_raw') }}
),

typed as (
    select
        json ->> 'business_id'                        as business_id,
        json ->> 'category'                           as category,
        json ->> 'opening_type'                       as opening_type,
        json ->> 'replaces_name'                      as replaces_name,
        json ->> 'likely_cuisine'                     as likely_cuisine,
        cast(json ->> 'confidence' as double)         as confidence,
        json ->> 'reason'                             as reason,
        json ->> 'model'                              as model,
        json ->> 'input_hash'                         as input_hash,
        cast(json ->> 'classified_at' as timestamptz) as classified_at,
        filename                                      as source_file
    from raw
)

select * exclude (recency)
from (
    select
        *,
        row_number() over (
            partition by business_id order by classified_at desc, source_file desc
        ) as recency
    from typed
)
where recency = 1
