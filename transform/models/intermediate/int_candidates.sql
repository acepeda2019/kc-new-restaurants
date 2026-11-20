-- Businesses that could be a new opening. Rules exclude what is clear-cut; Claude decides the
-- rest (category, new_opening / new_concept / ownership_transfer) from these columns.
-- A failed first inspection does NOT exclude a place: it ranks lower on safety (owner, 2026-11-17).
with establishments as (
    select * from {{ ref('int_establishments') }}
),

params as (
    select window_days, prior_same_name_min from {{ ref('score_params') }}
),

window_candidates as (
    select *
    from establishments
    cross join params
    where first_inspection_date > pulled_on - to_days(params.window_days)
      and rule_category <> 'excluded'
      and not is_venue_excluded
      and not is_closed_by_latest_inspection
),

-- Earlier businesses at the same premises that could be this one's predecessor. Same address
-- key, and not a neighbour: a different unit in the building is a different premises (no unit
-- on either side counts as the same), and a differently named business still inspected on or
-- after this one's first inspection was still open, so it wasn't replaced. A same-name one is
-- kept even then: that's the county re-issuing an id (ownership_transfer).
prior_at_address as (
    select
        c.business_id,
        to_json(list(
            {
                'business_id': o.business_id,
                'name': o.business_name,
                'classification': o.classification,
                'first_inspection_date': o.first_inspection_date,
                'latest_inspection_date': o.latest_inspection_date
            }
            order by o.latest_inspection_date desc, o.business_id
        )) as prior_businesses_at_address
    from window_candidates as c
    join establishments as o
        on o.geocode_key = c.geocode_key
        and o.business_id <> c.business_id
        and o.first_inspection_date < c.first_inspection_date
        and o.latest_inspection_date between c.first_inspection_date - interval 365 day
                                         and c.first_inspection_date + interval 30 day
        and (
            {{ address_unit('o.address') }} is null
            or {{ address_unit('c.address') }} is null
            or {{ address_unit('o.address') }} = {{ address_unit('c.address') }}
        )
        and (
            o.latest_inspection_date < c.first_inspection_date
            or jaro_winkler_similarity({{ name_key('o.business_name') }}, {{ name_key('c.business_name') }})
                >= c.prior_same_name_min
        )
    group by c.business_id
)

select
    window_candidates.* exclude (window_days, prior_same_name_min),
    coalesce(prior_at_address.prior_businesses_at_address, to_json([])) as prior_businesses_at_address
from window_candidates
left join prior_at_address using (business_id)
