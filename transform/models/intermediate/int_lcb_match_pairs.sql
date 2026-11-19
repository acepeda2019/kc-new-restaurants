-- Every candidate pairing of an Opening soon notice with a KC business at the same ZIP and
-- street number, scored and decided by the rules in seeds/lcb_match_params.csv. Kept in full
-- (not just winners) so match quality can be reviewed.
with notices as (
    select * from {{ ref('int_opening_soon_candidates') }}
),

businesses as (
    select * from {{ ref('int_establishments') }}
),

params as (
    select * from {{ ref('lcb_match_params') }}
),

-- Upper-case, punctuation to spaces, drop company suffixes and "THE", collapse spaces.
notice_keys as (
    select
        notice_id,
        application_date,
        zip5,
        regexp_extract(street_address, '^(\d+)', 1) as street_number,
        trim(regexp_replace(regexp_replace(regexp_replace(upper(trade_name), '[^A-Z0-9 ]', ' ', 'g'),
            '\b(LLC|L L C|INC|CO|CORP|THE)\b', ' ', 'g'), '\s+', ' ', 'g')) as name_key
    from notices
),

business_keys as (
    select
        business_id,
        business_name,
        first_inspection_date,
        zip5,
        regexp_extract(address, '^(\d+)', 1) as street_number,
        trim(regexp_replace(regexp_replace(regexp_replace(upper(business_name), '[^A-Z0-9 ]', ' ', 'g'),
            '\b(LLC|L L C|INC|CO|CORP|THE)\b', ' ', 'g'), '\s+', ' ', 'g')) as name_key
    from businesses
),

pairs as (
    select
        n.notice_id,
        b.business_id,
        b.business_name,
        b.first_inspection_date,
        round(jaro_winkler_similarity(n.name_key, b.name_key), 3) as name_score,
        b.first_inspection_date >= n.application_date - to_days(p.inspection_lead_days) as is_after_application,
        p.name_score_min,
        p.name_score_review_min
    from notice_keys as n
    join business_keys as b
        on b.zip5 = n.zip5
        and b.street_number = n.street_number
        and n.street_number <> ''
    cross join params as p
)

select
    notice_id || '|' || business_id as pair_id,
    notice_id,
    business_id,
    business_name,
    first_inspection_date,
    name_score,
    is_after_application,
    case
        when not is_after_application then 'previous_business'
        when name_score >= name_score_min then 'match'
        when name_score >= name_score_review_min then 'review'
        else 'different_name'
    end as decision
from pairs
