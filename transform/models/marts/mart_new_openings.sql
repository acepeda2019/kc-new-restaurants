with candidates as (
    select * from {{ ref('int_candidates') }}
),

decisions as (
    select * from {{ ref('int_classified_candidates') }} where review_status = 'accepted'
),

violations as (
    select * from {{ ref('stg_kc__inspection_violations') }}
),

params as (
    select * from {{ ref('score_params') }}
),

red_violations as (
    select
        business_id,
        list(
            {'date': inspection_date, 'description': violation_description, 'points': violation_points}
            order by inspection_date desc, violation_points desc
        )[1:5] as red_violations
    from violations
    where violation_type = 'RED'
    group by business_id
),

scored as (
    select
        candidates.*,
        decisions.* exclude (business_id, review_status),
        date_diff('day', candidates.first_inspection_date, candidates.pulled_on) as days_open,
        power(0.5, date_diff('day', candidates.first_inspection_date, candidates.pulled_on)
              / params.half_life_days)                                          as freshness,
        greatest(0, 1 - candidates.first_inspection_red_points / params.safety_floor_points) as safety,
        params.w_freshness,
        params.w_safety
    from candidates
    join decisions using (business_id)
    cross join params
),

final as (
    select
        *,
        round(100 * (w_freshness * freshness + w_safety * safety), 1) as score
    from scored
)

select
    final.business_id                                           as restaurant_id,
    final.business_name                                         as name,
    final.address,
    final.city_normalized                                       as city,
    final.zip5,
    final.latitude,
    final.longitude,
    final.geocode_match_status,
    final.category,
    final.opening_type,
    final.replaces_name,
    final.likely_cuisine,
    final.first_inspection_date,
    final.days_open,
    final.first_inspection_type,
    final.first_inspection_result,
    final.first_inspection_red_points,
    final.latest_inspection_date,
    final.latest_red_points,
    coalesce(red_violations.red_violations, [])                 as red_violations,
    round(final.freshness, 3)                                   as freshness,
    round(final.safety, 3)                                      as safety,
    final.score,
    row_number() over (
        order by final.score desc, final.first_inspection_date desc, final.business_id
    )                                                           as rank,
    concat_ws('; ',
        'First inspected ' || strftime(final.first_inspection_date, '%b %-d'),
        case
            when final.first_inspection_type = 'Educational Inspection'
                then 'first visit was educational (not scored)'
            when final.first_inspection_red_points = 0 then 'clean first inspection'
            else final.first_inspection_red_points || ' red points at first inspection'
        end,
        case when final.opening_type = 'new_concept' then 'replaces ' || final.replaces_name end
    )                                                           as why,
    final.source,
    final.confidence,
    final.reason                                                as classification_reason
from final
left join red_violations using (business_id)
