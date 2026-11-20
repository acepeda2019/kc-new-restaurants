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

-- Names compared as name_key (macros/name_key.sql).
notice_keys as (
    select
        notice_id,
        application_date,
        zip5,
        regexp_extract(street_address, '^(\d+)', 1) as street_number,
        {{ name_key('trade_name') }} as name_key,
        -- KC often records the company, not the trade name (source card): score both.
        {{ name_key("coalesce(licensee_name, '')") }} as licensee_key
    from notices
),

business_keys as (
    select
        business_id,
        business_name,
        first_inspection_date,
        zip5,
        regexp_extract(address, '^(\d+)', 1) as street_number,
        {{ name_key('business_name') }} as name_key
    from businesses
),

pairs as (
    select
        n.notice_id,
        b.business_id,
        b.business_name,
        b.first_inspection_date,
        round(greatest(
            jaro_winkler_similarity(n.name_key, b.name_key),
            case when n.licensee_key <> '' then jaro_winkler_similarity(n.licensee_key, b.name_key) else 0 end
        ), 3) as name_score,
        case
            when n.licensee_key <> ''
                and jaro_winkler_similarity(n.licensee_key, b.name_key) > jaro_winkler_similarity(n.name_key, b.name_key)
            then 'licensee_name' else 'trade_name'
        end as matched_on,
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
    matched_on,
    is_after_application,
    case
        when not is_after_application then 'previous_business'
        when name_score >= name_score_min then 'match'
        when name_score >= name_score_review_min then 'review'
        else 'different_name'
    end as decision
from pairs
