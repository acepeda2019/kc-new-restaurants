with openings as (
    select * from {{ ref('mart_new_openings') }}
),

pulled as (
    select max(pulled_on) as pulled_on from {{ ref('int_establishments') }}
),

pending as (
    select count(*) as pending_review_count
    from {{ ref('int_classified_candidates') }}
    where review_status = 'pending'
),

by_city as (
    select to_json(list({'city': city, 'openings': n} order by n desc, city)[1:10]) as by_city
    from (select city, count(*) as n from openings group by city)
)

select
    current_timestamp                                                     as built_at,
    pulled.pulled_on,
    count(*) filter (where openings.days_open < 30)                       as opened_last_30_days,
    count(*) filter (where openings.days_open >= 30 and openings.days_open < 60) as opened_prior_30_days,
    count(*) filter (where openings.days_open < 7)                        as opened_last_7_days,
    count(*)                                                              as opened_last_180_days,
    count(*) filter (where openings.first_inspection_red_points = 0
                     and openings.first_inspection_type <> 'Educational Inspection') as clean_first_inspection_count,
    any_value(by_city.by_city)                                            as by_city,
    any_value(pending.pending_review_count)                               as pending_review_count
from openings
cross join pulled
cross join pending
cross join by_city
group by pulled.pulled_on
