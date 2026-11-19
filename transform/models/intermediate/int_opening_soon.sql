-- One row per Opening soon notice, with whether it has opened: an owner override first, else
-- the best rule match (highest name score, then earliest first inspection).
with notices as (
    select * from {{ ref('int_opening_soon_candidates') }}
),

pairs as (
    select * from {{ ref('int_lcb_match_pairs') }}
),

businesses as (
    select business_id, first_inspection_date from {{ ref('int_establishments') }}
),

overrides as (
    select * from {{ ref('lcb_match_overrides') }}
),

best_rule_match as (
    select * exclude (rn)
    from (
        select
            notice_id,
            business_id,
            first_inspection_date,
            row_number() over (
                partition by notice_id order by name_score desc, first_inspection_date, business_id
            ) as rn
        from pairs
        where decision = 'match'
    )
    where rn = 1
),

review_counts as (
    select notice_id, count(*) as pairs_for_review
    from pairs
    where decision = 'review'
    group by notice_id
)

select
    n.*,
    case
        when o.notice_id is not null then nullif(o.business_id, '')
        else m.business_id
    end as opened_business_id,
    case
        when o.notice_id is not null then ob.first_inspection_date
        else m.first_inspection_date
    end as opened_on,
    case
        when o.notice_id is not null then 'override'
        when m.business_id is not null then 'rule'
    end as match_method,
    coalesce(r.pairs_for_review, 0) as pairs_for_review
from notices as n
left join overrides as o using (notice_id)
left join businesses as ob on ob.business_id = nullif(o.business_id, '')
left join best_rule_match as m using (notice_id)
left join review_counts as r using (notice_id)
