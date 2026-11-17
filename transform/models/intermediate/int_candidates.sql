-- Businesses that could be a new opening. Rules exclude what is clear-cut; Claude decides the
-- rest (category, new_opening / new_concept / ownership_transfer) from these columns.
-- A failed first inspection does NOT exclude a place: it ranks lower on safety (owner, 2026-11-17).
with establishments as (
    select * from {{ ref('int_establishments') }}
),

window_candidates as (
    select *
    from establishments
    where first_inspection_date > pulled_on - interval 180 day
      and rule_category <> 'excluded'
      and not is_venue_excluded
      and not is_closed_by_latest_inspection
),

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
            order by o.latest_inspection_date desc
        )) as prior_businesses_at_address
    from window_candidates as c
    join establishments as o
        on o.geocode_key = c.geocode_key
        and o.business_id <> c.business_id
        and o.first_inspection_date < c.first_inspection_date
        and o.latest_inspection_date between c.first_inspection_date - interval 365 day
                                         and c.first_inspection_date + interval 30 day
    group by c.business_id
)

select
    window_candidates.*,
    coalesce(prior_at_address.prior_businesses_at_address, to_json([])) as prior_businesses_at_address
from window_candidates
left join prior_at_address using (business_id)
