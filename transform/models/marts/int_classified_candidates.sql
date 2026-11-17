-- Each candidate's decision: an owner override always wins, else Claude's latest answer.
-- accepted = shown in the app; rejected = excluded or an ownership transfer;
-- pending = no answer yet, or Claude below min_confidence (the owner's review list).
with candidates as (
    select business_id from {{ ref('int_candidates') }}
),

claude as (
    select * from {{ ref('stg_claude__classifications') }}
),

overrides as (
    select * from {{ ref('classification_overrides') }}
),

params as (
    select min_confidence from {{ ref('score_params') }}
),

decided as (
    select
        candidates.business_id,
        case when overrides.business_id is not null then 'override'
             when claude.business_id is not null then 'claude' end              as source,
        coalesce(overrides.category, claude.category)                         as category,
        coalesce(overrides.opening_type, claude.opening_type)                 as opening_type,
        case when overrides.business_id is not null then overrides.replaces_name
             else claude.replaces_name end                                    as replaces_name,
        case when overrides.business_id is not null then overrides.likely_cuisine
             else claude.likely_cuisine end                                   as likely_cuisine,
        case when overrides.business_id is not null then 1.0
             else claude.confidence end                                       as confidence,
        coalesce(overrides.note, claude.reason)                               as reason,
        params.min_confidence
    from candidates
    cross join params
    left join claude using (business_id)
    left join overrides using (business_id)
)

select
    business_id,
    source,
    category,
    opening_type,
    replaces_name,
    likely_cuisine,
    confidence,
    reason,
    case
        when source is null or (source = 'claude' and confidence < min_confidence) then 'pending'
        when category = 'excluded' or opening_type = 'ownership_transfer' then 'rejected'
        else 'accepted'
    end as review_status
from decided
